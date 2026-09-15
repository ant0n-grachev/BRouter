import type { RoutedPath, RoutingRequest } from './routingTypes';

const ROUTE_ENDPOINT = '/.netlify/functions/route';
const INVALID_ROUTE_MESSAGE = 'Routing returned an invalid route.';
const CLIENT_TIMEOUT_MS = 20_000;
const TIMEOUT_MESSAGE = 'Routing request timed out. Please try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseRoutedPath(value: unknown): RoutedPath {
  if (!isRecord(value) || !Array.isArray(value.geometry) || !Array.isArray(value.instructions)) {
    throw new Error(INVALID_ROUTE_MESSAGE);
  }

  const geometry = value.geometry.map((point) => {
    if (
      !isRecord(point) ||
      typeof point.lat !== 'number' ||
      !Number.isFinite(point.lat) ||
      point.lat < -90 ||
      point.lat > 90 ||
      typeof point.lon !== 'number' ||
      !Number.isFinite(point.lon) ||
      point.lon < -180 ||
      point.lon > 180
    ) {
      throw new Error(INVALID_ROUTE_MESSAGE);
    }

    return { lat: point.lat, lon: point.lon };
  });

  if (geometry.length < 2 || geometry.length > 20_000) {
    throw new Error(INVALID_ROUTE_MESSAGE);
  }

  const instructions = value.instructions.map((instruction) => {
    if (
      !isRecord(instruction) ||
      typeof instruction.text !== 'string' ||
      instruction.text.trim() === '' ||
      !isFiniteNonNegative(instruction.distanceMeters) ||
      !isFiniteNonNegative(instruction.durationSeconds) ||
      typeof instruction.geometryIndex !== 'number' ||
      !Number.isInteger(instruction.geometryIndex) ||
      instruction.geometryIndex < 0 ||
      instruction.geometryIndex >= geometry.length
    ) {
      throw new Error(INVALID_ROUTE_MESSAGE);
    }

    return {
      text: instruction.text,
      distanceMeters: instruction.distanceMeters,
      durationSeconds: instruction.durationSeconds,
      geometryIndex: instruction.geometryIndex,
    };
  });

  if (
    instructions.length === 0 ||
    !isFiniteNonNegative(value.distanceMeters) ||
    !isFiniteNonNegative(value.durationSeconds)
  ) {
    throw new Error(INVALID_ROUTE_MESSAGE);
  }

  return {
    geometry,
    instructions,
    distanceMeters: value.distanceMeters,
    durationSeconds: value.durationSeconds,
  };
}

export async function fetchRoute(
  request: RoutingRequest,
  signal?: AbortSignal,
): Promise<RoutedPath> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => {
    const reason: unknown = signal?.reason;
    controller.abort(reason instanceof Error ? reason : new DOMException('Canceled', 'AbortError'));
  };

  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
  }, CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch(ROUTE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'Routing is temporarily unavailable.';
      throw new Error(message);
    }

    return parseRoutedPath(payload);
  } catch (error) {
    if (timedOut) throw new Error(TIMEOUT_MESSAGE, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
