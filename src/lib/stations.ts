import type { LatLon, Station } from '../types';
import { haversineKm, kmToMiles } from './distance';

export const MAX_STATION_DISTANCE_MILES = 1;
export const EFFECTIVE_DISTANCE_TIE_MILES = 0.000001;

export type StationRankKind = 'pickup' | 'dropoff';
export type StationRankReason = 'closest' | 'more-availability' | 'next-closest';

export interface RankedStation {
  station: Station;
  distanceMi: number;
  reason: StationRankReason;
}

export interface StationRankingOptions {
  kind: StationRankKind;
  excludeStationId?: string;
  maxDistanceMiles?: number;
  limit?: number;
}

type MeasuredStation = Omit<RankedStation, 'reason'>;

function isEligibleForKind(station: Station, kind: StationRankKind): boolean {
  if (!station.is_installed) return false;
  if (kind === 'pickup') {
    return station.is_renting && station.num_bikes_available > 0;
  }
  return station.is_returning && station.num_docks_available > 0;
}

function compareDistanceThenId(
  a: MeasuredStation,
  b: MeasuredStation,
  kind: StationRankKind,
): number {
  const distanceDelta = a.distanceMi - b.distanceMi;
  if (Math.abs(distanceDelta) <= EFFECTIVE_DISTANCE_TIE_MILES) {
    return (
      availability(b, kind) - availability(a, kind) ||
      a.station.station_id.localeCompare(b.station.station_id)
    );
  }
  return distanceDelta || a.station.station_id.localeCompare(b.station.station_id);
}

function availability(candidate: MeasuredStation, kind: StationRankKind): number {
  return kind === 'pickup'
    ? candidate.station.num_bikes_available
    : candidate.station.num_docks_available;
}

export function rankStations(
  stations: Station[],
  point: LatLon,
  {
    kind,
    excludeStationId,
    maxDistanceMiles = MAX_STATION_DISTANCE_MILES,
    limit = 3,
  }: StationRankingOptions,
): RankedStation[] {
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return [];
  const eligible = stations.reduce<MeasuredStation[]>((candidates, station) => {
    if (!isEligibleForKind(station, kind)) return candidates;
    if (
      !Number.isFinite(station.lat) ||
      !Number.isFinite(station.lon) ||
      station.lat < -90 ||
      station.lat > 90 ||
      station.lon < -180 ||
      station.lon > 180
    ) {
      return candidates;
    }
    const distanceMi = kmToMiles(haversineKm(point, { lat: station.lat, lon: station.lon }));
    if (distanceMi <= maxDistanceMiles) candidates.push({ station, distanceMi });
    return candidates;
  }, []);
  const alternatives = excludeStationId
    ? eligible.filter((candidate) => candidate.station.station_id !== excludeStationId)
    : eligible;
  const candidates = alternatives.length > 0 ? alternatives : eligible;
  if (candidates.length === 0 || limit <= 0) return [];

  const byDistance = [...candidates].sort((a, b) => compareDistanceThenId(a, b, kind));
  const closest = byDistance[0];
  const ranked: RankedStation[] = [{ ...closest, reason: 'closest' }];

  const nextClosest = byDistance[1];
  if (nextClosest && ranked.length < limit) {
    ranked.push({ ...nextClosest, reason: 'next-closest' });
  }

  const selectedIds = new Set(ranked.map((candidate) => candidate.station.station_id));
  if (ranked.length < limit) {
    const closestAvailability = availability(closest, kind);
    const moreAvailability = byDistance
      .filter(
        (candidate) =>
          !selectedIds.has(candidate.station.station_id) &&
          availability(candidate, kind) > closestAvailability,
      )
      .sort(
        (a, b) =>
          availability(b, kind) - availability(a, kind) || compareDistanceThenId(a, b, kind),
      )[0];

    if (moreAvailability) {
      ranked.push({ ...moreAvailability, reason: 'more-availability' });
      selectedIds.add(moreAvailability.station.station_id);
    }
  }

  for (const candidate of byDistance) {
    if (ranked.length >= limit) break;
    if (selectedIds.has(candidate.station.station_id)) continue;
    ranked.push({ ...candidate, reason: 'next-closest' });
    selectedIds.add(candidate.station.station_id);
  }

  return ranked;
}
