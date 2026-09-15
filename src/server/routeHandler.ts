import type { RoutedPath, RoutingRequest } from '../features/navigation/routingTypes.ts';
import type { LatLon } from '../types.ts';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions';
const MADISON_CENTER = { lat: 43.0731, lon: -89.4012 };
const MAX_DISTANCE_FROM_MADISON_METERS = 25 * 1_609.344;
const MAX_BODY_BYTES = 4_096;
const MAX_GEOMETRY_POINTS = 20_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_INTERVAL_MS = 1_500;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 32;

export interface RouteHandlerOptions {
  apiKey?: string;
  getApiKey?: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
  minIntervalMs?: number;
}

interface CacheEntry {
  expiresAt: number;
  route: RoutedPath;
}

class InvalidProviderResponse extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function isPoint(value: unknown): value is LatLon {
  return (
    isRecord(value) &&
    isFiniteCoordinate(value.lat, -90, 90) &&
    isFiniteCoordinate(value.lon, -180, 180)
  );
}

function distanceMeters(from: LatLon, to: LatLon): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (to.lat - from.lat) * radians;
  const longitudeDelta = (to.lon - from.lon) * radians;
  const fromLatitude = from.lat * radians;
  const toLatitude = to.lat * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function isRoutingRequest(value: unknown): value is RoutingRequest {
  if (
    !isRecord(value) ||
    !isPoint(value.from) ||
    !isPoint(value.to) ||
    (value.mode !== 'walking' && value.mode !== 'bicycling')
  ) {
    return false;
  }

  return (
    distanceMeters(MADISON_CENTER, value.from) <= MAX_DISTANCE_FROM_MADISON_METERS &&
    distanceMeters(MADISON_CENTER, value.to) <= MAX_DISTANCE_FROM_MADISON_METERS &&
    distanceMeters(value.from, value.to) <= MAX_DISTANCE_FROM_MADISON_METERS
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseProviderRoute(payload: unknown): RoutedPath {
  if (!isRecord(payload) || !Array.isArray(payload.features) || payload.features.length !== 1) {
    throw new InvalidProviderResponse();
  }

  const features: unknown[] = payload.features;
  const feature = features[0];
  if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) {
    throw new InvalidProviderResponse();
  }

  const coordinates = feature.geometry.coordinates;
  if (
    feature.geometry.type !== 'LineString' ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.length > MAX_GEOMETRY_POINTS
  ) {
    throw new InvalidProviderResponse();
  }

  const geometry = coordinates.map((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !isFiniteCoordinate(coordinate[0], -180, 180) ||
      !isFiniteCoordinate(coordinate[1], -90, 90)
    ) {
      throw new InvalidProviderResponse();
    }
    return { lat: coordinate[1], lon: coordinate[0] };
  });

  const summary = feature.properties.summary;
  const segments = feature.properties.segments;
  if (
    !isRecord(summary) ||
    !finiteNonNegative(summary.distance) ||
    !finiteNonNegative(summary.duration) ||
    !Array.isArray(segments) ||
    segments.length === 0
  ) {
    throw new InvalidProviderResponse();
  }

  const instructions = segments.flatMap((segment) => {
    if (!isRecord(segment) || !Array.isArray(segment.steps)) {
      throw new InvalidProviderResponse();
    }

    return segment.steps.map((step) => {
      if (
        !isRecord(step) ||
        typeof step.instruction !== 'string' ||
        step.instruction.trim() === '' ||
        !finiteNonNegative(step.distance) ||
        !finiteNonNegative(step.duration) ||
        !Array.isArray(step.way_points) ||
        !Number.isInteger(step.way_points[0]) ||
        (step.way_points[0] as number) < 0 ||
        (step.way_points[0] as number) >= geometry.length
      ) {
        throw new InvalidProviderResponse();
      }

      return {
        text: step.instruction,
        distanceMeters: step.distance,
        durationSeconds: step.duration,
        geometryIndex: step.way_points[0] as number,
      };
    });
  });

  if (instructions.length === 0) throw new InvalidProviderResponse();

  return {
    geometry,
    instructions,
    distanceMeters: summary.distance,
    durationSeconds: summary.duration,
  };
}

function cacheKey(request: RoutingRequest): string {
  const point = (value: LatLon) => `${value.lat.toFixed(5)},${value.lon.toFixed(5)}`;
  return `${request.mode}:${point(request.from)}:${point(request.to)}`;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        const reason: unknown = signal.reason;
        reject(reason instanceof Error ? reason : new DOMException('Canceled', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function createRouteHandler(options: RouteHandlerOptions = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const cache = new Map<string, CacheEntry>();
  let outboundQueue = Promise.resolve();
  let lastRequestStartedAt = Number.NEGATIVE_INFINITY;

  function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const scheduled = outboundQueue.then(async () => {
      if (signal?.aborted) {
        const reason: unknown = signal.reason;
        throw reason instanceof Error ? reason : new DOMException('Canceled', 'AbortError');
      }
      const waitMilliseconds = Math.max(0, lastRequestStartedAt + minIntervalMs - now());
      if (waitMilliseconds > 0) await sleep(waitMilliseconds, signal);
      lastRequestStartedAt = now();
      return task();
    });
    outboundQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Only POST requests are supported.' }, 405);
    }

    const apiKey = options.getApiKey?.() ?? options.apiKey;
    if (!apiKey) {
      return jsonResponse({ error: 'In-app routing is not configured yet.' }, 503);
    }

    const controller = new AbortController();
    const abortFromRequest = () => {
      const reason: unknown = request.signal.reason;
      controller.abort(
        reason instanceof Error ? reason : new DOMException('Canceled', 'AbortError'),
      );
    };
    const canceledResponse = () => jsonResponse({ error: 'Routing request was canceled.' }, 499);
    const finishEarly = (response: Response) => {
      request.signal.removeEventListener('abort', abortFromRequest);
      return response;
    };

    if (request.signal.aborted) {
      abortFromRequest();
      return canceledResponse();
    }
    request.signal.addEventListener('abort', abortFromRequest, { once: true });

    let body: unknown;
    try {
      const text = await request.text();
      if (controller.signal.aborted) return finishEarly(canceledResponse());
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        return finishEarly(jsonResponse({ error: 'Invalid routing request.' }, 400));
      }
      body = JSON.parse(text);
    } catch {
      return finishEarly(
        controller.signal.aborted
          ? canceledResponse()
          : jsonResponse({ error: 'Invalid routing request.' }, 400),
      );
    }

    if (!isRoutingRequest(body)) {
      return finishEarly(jsonResponse({ error: 'Invalid routing request.' }, 400));
    }

    const key = cacheKey(body);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return finishEarly(jsonResponse(cached.route, 200));
    }
    if (cached) cache.delete(key);

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
    }, timeoutMs);

    try {
      const profile = body.mode === 'walking' ? 'foot-walking' : 'cycling-regular';
      const providerResponse = await schedule(
        () =>
          fetchImpl(`${ORS_BASE_URL}/${profile}/geojson`, {
            method: 'POST',
            headers: {
              authorization: apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              coordinates: [
                [body.from.lon, body.from.lat],
                [body.to.lon, body.to.lat],
              ],
              instructions: true,
            }),
            signal: controller.signal,
          }),
        controller.signal,
      );

      if (providerResponse.status === 429) {
        return jsonResponse({ error: 'Routing is busy. Please try again shortly.' }, 429);
      }
      if (providerResponse.status === 404 || providerResponse.status === 422) {
        return jsonResponse({ error: 'No route found for those locations.' }, 422);
      }
      if (!providerResponse.ok) {
        return jsonResponse({ error: 'Routing is temporarily unavailable.' }, 502);
      }

      const route = parseProviderRoute(await providerResponse.json());
      cache.set(key, { route, expiresAt: now() + CACHE_TTL_MS });
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        cache.delete(oldestKey);
      }
      return jsonResponse(route, 200);
    } catch {
      if (timedOut) {
        return jsonResponse({ error: 'Routing timed out. Please try again.' }, 504);
      }
      if (request.signal.aborted) {
        return jsonResponse({ error: 'Routing request was canceled.' }, 499);
      }
      return jsonResponse({ error: 'Routing is temporarily unavailable.' }, 502);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abortFromRequest);
    }
  };
}

const productionHandler = createRouteHandler({
  getApiKey: () => process.env.OPENROUTESERVICE_API_KEY,
});

export function handleRouteRequest(request: Request): Promise<Response> {
  return productionHandler(request);
}
