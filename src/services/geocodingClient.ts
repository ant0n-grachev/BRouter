import { z } from 'zod';
import { isPointWithinStationServiceArea, type StationServiceArea } from '../lib/coverage';

export interface GeocodeSuggestion {
  lat: number;
  lon: number;
  label: string;
}

export type GeocodingSearchOutcome =
  { kind: 'results'; suggestions: readonly GeocodeSuggestion[] } | { kind: 'empty' };

export type GeocodingErrorCode =
  'offline' | 'rate_limited' | 'network' | 'aborted' | 'invalid_coordinates';

export class GeocodingClientError extends Error {
  readonly code: GeocodingErrorCode;
  readonly status?: number;

  constructor(code: GeocodingErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GeocodingClientError';
    this.code = code;
    this.status = status;
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface GeocodingClientDependencies {
  fetch?: FetchLike;
  now?: () => number;
  storage?: StorageLike | null;
  sleep?: Sleep;
  online?: () => boolean;
}

export interface GeocodingSearchOptions {
  signal?: AbortSignal;
  serviceArea?: StationServiceArea;
}

export interface GeocodingClient {
  search(query: string, options?: GeocodingSearchOptions): Promise<GeocodingSearchOutcome>;
}

const CACHE_KEY = 'bcycle.geocoding-cache.v2';
const CACHE_VERSION = 2;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const MIN_REQUEST_INTERVAL_MS = 1000;

const CoordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

const SuggestionSchema = CoordinateSchema.extend({ label: z.string() });
const CacheEntrySchema = z.object({
  key: z.string().min(1),
  createdAt: z.number().finite(),
  suggestions: z.array(SuggestionSchema).max(5),
});
const PersistedCacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  entries: z.array(CacheEntrySchema).max(MAX_CACHE_ENTRIES),
});
const PhotonFeatureSchema = z
  .object({
    geometry: z.object({
      type: z.literal('Point'),
      coordinates: z.array(z.number()).min(2),
    }),
    properties: z
      .object({
        name: z.string().optional(),
        housenumber: z.string().optional(),
        street: z.string().optional(),
        locality: z.string().optional(),
        district: z.string().optional(),
        city: z.string().optional(),
        county: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

interface CacheEntry {
  key: string;
  createdAt: number;
  suggestions: readonly GeocodeSuggestion[];
}

function normalizeCacheKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseCoordinateInput(query: string): GeocodeSuggestion | null {
  const parts = query.split(',');
  if (parts.length !== 2) return null;
  const latitude = parts[0].trim();
  const longitude = parts[1].trim();
  if (!latitude || !longitude) return null;

  const parsed = CoordinateSchema.safeParse({
    lat: Number(latitude),
    lon: Number(longitude),
  });
  if (!parsed.success) return null;

  const { lat, lon } = parsed.data;
  return { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
}

function hasNumericCoordinateSyntax(query: string): boolean {
  const parts = query.split(',');
  return (
    parts.length === 2 &&
    parts.every((part) => part.trim().length > 0 && Number.isFinite(Number(part.trim())))
  );
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function abortedError(): GeocodingClientError {
  return new GeocodingClientError('aborted', 'Geocoding request was aborted.');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError();
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      globalThis.clearTimeout(timeoutId);
      reject(abortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readStorageCache(storage: StorageLike | null, now: number): CacheEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsedJson: unknown = JSON.parse(raw);
    const parsedCache = PersistedCacheSchema.safeParse(parsedJson);
    if (!parsedCache.success) return [];

    return parsedCache.data.entries.filter((entry) => now - entry.createdAt <= CACHE_TTL_MS);
  } catch {
    return [];
  }
}

function persistCache(storage: StorageLike | null, entries: readonly CacheEntry[]): void {
  if (!storage) return;
  try {
    storage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        entries,
      }),
    );
  } catch {
    // Private browsing and quota errors must not block address search.
  }
}

function photonLabel(
  properties: z.infer<typeof PhotonFeatureSchema>['properties'],
  lat: number,
  lon: number,
): string {
  const addressLine = [properties.housenumber, properties.street].filter(Boolean).join(' ');
  const parts = [
    properties.name,
    addressLine,
    properties.locality,
    properties.district,
    properties.city,
    properties.county,
    properties.state,
    properties.postcode,
    properties.country,
  ];
  const seen = new Set<string>();
  const unique = parts.filter((part): part is string => {
    const normalized = part?.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return unique.join(', ') || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function parsePhotonResponse(payload: unknown): GeocodeSuggestion[] {
  const response = z.object({ features: z.array(z.unknown()) }).safeParse(payload);
  if (!response.success) return [];

  const suggestions: GeocodeSuggestion[] = [];
  for (const unknownFeature of response.data.features) {
    const feature = PhotonFeatureSchema.safeParse(unknownFeature);
    if (!feature.success) continue;

    const coordinates = CoordinateSchema.safeParse({
      lat: feature.data.geometry.coordinates[1],
      lon: feature.data.geometry.coordinates[0],
    });
    if (!coordinates.success) continue;

    const { lat, lon } = coordinates.data;
    const label = photonLabel(feature.data.properties, lat, lon);
    suggestions.push({
      lat,
      lon,
      label,
    });
  }
  return suggestions;
}

function deduplicateSuggestions(suggestions: readonly GeocodeSuggestion[]): GeocodeSuggestion[] {
  const deduplicated: GeocodeSuggestion[] = [];
  const seenLabels = new Set<string>();
  for (const suggestion of suggestions) {
    const normalizedLabel = suggestion.label.toLocaleLowerCase();
    if (seenLabels.has(normalizedLabel)) continue;
    seenLabels.add(normalizedLabel);
    deduplicated.push(suggestion);
    if (deduplicated.length === 5) break;
  }
  return deduplicated;
}

class PhotonGeocodingClient implements GeocodingClient {
  private readonly cache = new Map<string, CacheEntry>();
  private lastOutboundRequestAt: number | null = null;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: Required<GeocodingClientDependencies>) {
    for (const entry of readStorageCache(dependencies.storage, dependencies.now())) {
      this.cache.set(entry.key, entry);
    }
  }

  async search(
    query: string,
    { signal, serviceArea }: GeocodingSearchOptions = {},
  ): Promise<GeocodingSearchOutcome> {
    throwIfAborted(signal);
    const normalizedQuery = normalizeCacheKey(query);
    if (!normalizedQuery) return { kind: 'empty' };

    const localCoordinates = parseCoordinateInput(normalizedQuery);
    if (localCoordinates) {
      return { kind: 'results', suggestions: [localCoordinates] };
    }
    if (hasNumericCoordinateSyntax(normalizedQuery)) {
      throw new GeocodingClientError(
        'invalid_coordinates',
        'Latitude or longitude is outside its valid range.',
      );
    }

    const cacheKey = serviceArea
      ? `${normalizedQuery}|service-area:${serviceArea.cacheKey}`
      : normalizedQuery;
    const cached = this.readCacheEntry(cacheKey);
    if (cached) {
      return cached.suggestions.length > 0
        ? { kind: 'results', suggestions: cached.suggestions }
        : { kind: 'empty' };
    }

    if (!this.dependencies.online()) {
      throw new GeocodingClientError('offline', 'Geocoding is unavailable while offline.');
    }

    await this.waitForRequestSlot(signal);
    const response = await this.fetchSearchResponse(normalizedQuery, signal, serviceArea);
    const parsedSuggestions = await this.parseResponse(response);
    const areaFilteredSuggestions = serviceArea
      ? parsedSuggestions.filter((suggestion) =>
          isPointWithinStationServiceArea(serviceArea, suggestion),
        )
      : parsedSuggestions;
    const suggestions = deduplicateSuggestions(areaFilteredSuggestions);
    this.writeCacheEntry({ key: cacheKey, createdAt: this.dependencies.now(), suggestions });

    return suggestions.length > 0 ? { kind: 'results', suggestions } : { kind: 'empty' };
  }

  private readCacheEntry(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (this.dependencies.now() - entry.createdAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      this.persist();
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private writeCacheEntry(entry: CacheEntry): void {
    this.cache.delete(entry.key);
    this.cache.set(entry.key, entry);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
    this.persist();
  }

  private persist(): void {
    persistCache(this.dependencies.storage, Array.from(this.cache.values()));
  }

  private async waitForRequestSlot(signal: AbortSignal | undefined): Promise<void> {
    const request = this.requestQueue.then(async () => {
      throwIfAborted(signal);
      if (this.lastOutboundRequestAt !== null) {
        const elapsed = this.dependencies.now() - this.lastOutboundRequestAt;
        const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - elapsed);
        if (wait > 0) await this.dependencies.sleep(wait, signal);
      }
      throwIfAborted(signal);
      this.lastOutboundRequestAt = this.dependencies.now();
    });
    this.requestQueue = request.catch(() => undefined);
    return request;
  }

  private async fetchSearchResponse(
    key: string,
    signal: AbortSignal | undefined,
    serviceArea: StationServiceArea | undefined,
  ): Promise<Response> {
    const url = new URL('https://photon.komoot.io/api');
    url.searchParams.set('q', key);
    url.searchParams.set('limit', '5');
    if (serviceArea) {
      const { west, north, east, south } = serviceArea.bounds;
      url.searchParams.set('bbox', `${west},${south},${east},${north}`);
    }

    try {
      const response = await this.dependencies.fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (response.status === 429) {
        throw new GeocodingClientError(
          'rate_limited',
          'Geocoding is temporarily rate limited.',
          429,
        );
      }
      if (!response.ok) {
        throw new GeocodingClientError('network', 'Geocoding request failed.', response.status);
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof GeocodingClientError) throw error;
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw abortedError();
      }
      throw new GeocodingClientError('network', 'Geocoding request failed.');
    }
  }

  private async parseResponse(response: Response): Promise<GeocodeSuggestion[]> {
    try {
      const payload: unknown = await response.json();
      return parsePhotonResponse(payload);
    } catch {
      return [];
    }
  }
}

export function createGeocodingClient(
  dependencies: GeocodingClientDependencies = {},
): GeocodingClient {
  return new PhotonGeocodingClient({
    fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    now: dependencies.now ?? Date.now,
    storage: dependencies.storage === undefined ? defaultStorage() : dependencies.storage,
    sleep: dependencies.sleep ?? defaultSleep,
    online: dependencies.online ?? defaultOnline,
  });
}
