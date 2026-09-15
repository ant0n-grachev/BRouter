export interface Station {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  num_bikes_available: number;
  num_docks_available: number;
}

export interface StationSnapshot {
  stations: Station[];
  /** Local millisecond timestamp when this client completed the feed request. */
  fetchedAt: number;
  /** Earliest valid GBFS feed timestamp, represented in milliseconds, when supplied. */
  feedUpdatedAt: number | null;
  /** GBFS TTL when supplied; missing metadata remains null. */
  ttlSeconds: number | null;
  /** True when feed metadata, or the documented client fallback, is older than the current time. */
  isStale: boolean;
}

export type SystemAvailability =
  'operational' | 'no-bikes' | 'no-docks' | 'service-disabled' | 'stale' | 'unavailable';

export interface LatLon {
  lat: number;
  lon: number;
}
