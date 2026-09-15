import type { Station, StationSnapshot, SystemAvailability } from '../types';

export const GBFS_DISCOVERY_URL = 'https://gbfs.bcycle.com/bcycle_madison/gbfs.json';
/** Used only when the GBFS discovery document cannot identify both station feeds. */
export const DEFAULT_STATION_INFORMATION_URL =
  'https://gbfs.bcycle.com/bcycle_madison/station_information.json';
/** Used only when the GBFS discovery document cannot identify both station feeds. */
export const DEFAULT_STATION_STATUS_URL =
  'https://gbfs.bcycle.com/bcycle_madison/station_status.json';
export const STATION_CACHE_TTL_MS = 15_000;
/** Stale fallback only when GBFS does not provide usable last_updated and ttl metadata. */
export const FALLBACK_STALE_AFTER_MS = 15_000;
export const GBFS_REQUEST_TIMEOUT_MS = 8_000;

export type StationFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class StationFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StationFeedError';
  }
}

type StationFeedUrls = {
  information: string;
  status: string;
};

type CachedSnapshot = {
  snapshot: StationSnapshot | null;
  pending: Promise<StationSnapshot> | null;
};

const cache: CachedSnapshot = { snapshot: null, pending: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function gbfsFlag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

function nonNegativeCount(value: unknown): number | null {
  const count = finiteNumber(value);
  return count === null ? null : Math.max(0, count);
}

function validCoordinates(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function readStations(feed: unknown): unknown[] | null {
  if (!isRecord(feed) || !isRecord(feed.data) || !isUnknownArray(feed.data.stations)) return null;
  return feed.data.stations;
}

function feedMetadata(feed: unknown): { updatedAt: number; ttlSeconds: number } | null {
  if (!isRecord(feed)) return null;
  const lastUpdated = finiteNumber(feed.last_updated);
  const ttl = finiteNumber(feed.ttl);
  if (lastUpdated === null || ttl === null || lastUpdated <= 0 || ttl <= 0) return null;
  return { updatedAt: lastUpdated * 1_000, ttlSeconds: ttl };
}

function fallbackFeedUrls(): StationFeedUrls {
  return { information: DEFAULT_STATION_INFORMATION_URL, status: DEFAULT_STATION_STATUS_URL };
}

function parseDiscoveryUrls(discovery: unknown): StationFeedUrls | null {
  if (!isRecord(discovery) || !isRecord(discovery.data)) return null;
  const english = discovery.data.en;
  if (!isRecord(english) || !Array.isArray(english.feeds)) return null;

  let information: string | null = null;
  let status: string | null = null;
  for (const candidate of english.feeds) {
    if (!isRecord(candidate)) continue;
    const name = stringValue(candidate.name);
    const url = stringValue(candidate.url);
    if (name === 'station_information' && url) information = url;
    if (name === 'station_status' && url) status = url;
  }
  return information && status ? { information, status } : null;
}

async function fetchJson(fetcher: StationFetch, url: string, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), GBFS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      throw new StationFeedError(`Failed to load ${label} (${response.status}).`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function resolveFeedUrls(fetcher: StationFetch): Promise<StationFeedUrls> {
  try {
    const discovery = await fetchJson(fetcher, GBFS_DISCOVERY_URL, 'GBFS discovery');
    return parseDiscoveryUrls(discovery) ?? fallbackFeedUrls();
  } catch {
    return fallbackFeedUrls();
  }
}

function mergeStations(informationFeed: unknown, statusFeed: unknown): Station[] {
  const information = readStations(informationFeed);
  const statuses = readStations(statusFeed);
  if (!information || !statuses) {
    throw new StationFeedError('GBFS station feeds did not contain station lists.');
  }

  const infoById = new Map<string, { name: string; lat: number; lon: number }>();
  for (const entry of information) {
    if (!isRecord(entry)) continue;
    const stationId = stringValue(entry.station_id);
    const lat = finiteNumber(entry.lat);
    const lon = finiteNumber(entry.lon);
    if (!stationId || lat === null || lon === null || !validCoordinates(lat, lon)) continue;
    infoById.set(stationId, {
      name: stringValue(entry.name) ?? stationId,
      lat,
      lon,
    });
  }

  const stations: Station[] = [];
  for (const entry of statuses) {
    if (!isRecord(entry)) continue;
    const stationId = stringValue(entry.station_id);
    if (!stationId) continue;
    const info = infoById.get(stationId);
    const installed = gbfsFlag(entry.is_installed);
    const renting = gbfsFlag(entry.is_renting);
    const returning = gbfsFlag(entry.is_returning);
    const bikes = nonNegativeCount(entry.num_bikes_available);
    const docks = nonNegativeCount(entry.num_docks_available);
    if (
      !info ||
      installed === null ||
      renting === null ||
      returning === null ||
      bikes === null ||
      docks === null
    ) {
      continue;
    }
    stations.push({
      station_id: stationId,
      name: info.name,
      lat: info.lat,
      lon: info.lon,
      is_installed: installed,
      is_renting: renting,
      is_returning: returning,
      num_bikes_available: bikes,
      num_docks_available: docks,
    });
  }

  if (stations.length === 0) {
    throw new StationFeedError('GBFS station feeds contained no usable station records.');
  }
  return stations;
}

function snapshotMetadata(infoFeed: unknown, statusFeed: unknown) {
  const metadata = [feedMetadata(infoFeed), feedMetadata(statusFeed)].filter(
    (value): value is { updatedAt: number; ttlSeconds: number } => value !== null,
  );
  if (metadata.length === 0) {
    return { feedUpdatedAt: null, ttlSeconds: null };
  }
  return {
    // The older feed limits freshness: a trip needs both coordinates and availability.
    feedUpdatedAt: Math.min(...metadata.map((value) => value.updatedAt)),
    ttlSeconds: Math.min(...metadata.map((value) => value.ttlSeconds)),
  };
}

export function isStationSnapshotStale(
  snapshot: Omit<StationSnapshot, 'isStale'>,
  now = Date.now(),
): boolean {
  if (snapshot.feedUpdatedAt === null || snapshot.ttlSeconds === null) {
    return now > snapshot.fetchedAt + FALLBACK_STALE_AFTER_MS;
  }
  return now > snapshot.feedUpdatedAt + snapshot.ttlSeconds * 1_000;
}

function atCurrentStaleness(snapshot: StationSnapshot, now: number): StationSnapshot {
  return { ...snapshot, isStale: isStationSnapshotStale(snapshot, now) };
}

export interface LoadStationSnapshotOptions {
  forceRefresh?: boolean;
  fetcher?: StationFetch;
  now?: () => number;
}

async function fetchSnapshot(fetcher: StationFetch, now: () => number): Promise<StationSnapshot> {
  const urls = await resolveFeedUrls(fetcher);
  const [informationFeed, statusFeed] = await Promise.all([
    fetchJson(fetcher, urls.information, 'station information'),
    fetchJson(fetcher, urls.status, 'station status'),
  ]);
  const fetchedAt = now();
  const metadata = snapshotMetadata(informationFeed, statusFeed);
  const snapshot: StationSnapshot = {
    stations: mergeStations(informationFeed, statusFeed),
    fetchedAt,
    feedUpdatedAt: metadata.feedUpdatedAt,
    ttlSeconds: metadata.ttlSeconds,
    isStale: false,
  };
  return atCurrentStaleness(snapshot, fetchedAt);
}

export function loadStationSnapshot({
  forceRefresh = false,
  fetcher = fetch,
  now = Date.now,
}: LoadStationSnapshotOptions = {}): Promise<StationSnapshot> {
  const currentTime = now();
  if (
    !forceRefresh &&
    cache.snapshot &&
    currentTime - cache.snapshot.fetchedAt < STATION_CACHE_TTL_MS
  ) {
    return Promise.resolve(atCurrentStaleness(cache.snapshot, currentTime));
  }
  if (cache.pending) return cache.pending;

  const request = fetchSnapshot(fetcher, now)
    .then((snapshot) => {
      cache.snapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      if (cache.pending === request) cache.pending = null;
    });
  cache.pending = request;
  return request;
}

export function getSystemAvailability(snapshot: StationSnapshot | null): SystemAvailability {
  if (!snapshot) return 'unavailable';
  if (snapshot.isStale) return 'stale';

  const installed = snapshot.stations.filter((station) => station.is_installed);
  const canRent = installed.filter((station) => station.is_renting);
  const canReturn = installed.filter((station) => station.is_returning);
  if (installed.length === 0 || (canRent.length === 0 && canReturn.length === 0)) {
    return 'service-disabled';
  }
  if (canRent.length === 0 || canRent.every((station) => station.num_bikes_available === 0)) {
    return 'no-bikes';
  }
  if (canReturn.length === 0 || canReturn.every((station) => station.num_docks_available === 0)) {
    return 'no-docks';
  }
  return 'operational';
}

export function resetStationSnapshotCache() {
  cache.snapshot = null;
  cache.pending = null;
}
