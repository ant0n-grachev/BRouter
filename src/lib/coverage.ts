import type { LatLon, Station } from '../types';
import { haversineKm, kmToMiles } from './distance';
import { MAX_STATION_DISTANCE_MILES } from './stations';

export interface ServiceAreaBounds {
  west: number;
  north: number;
  east: number;
  south: number;
}

export interface StationServiceArea {
  bounds: ServiceAreaBounds;
  points: readonly LatLon[];
  cacheKey: string;
}

function isValidPoint(station: Station): boolean {
  return (
    station.is_installed &&
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lon) &&
    station.lat >= -90 &&
    station.lat <= 90 &&
    station.lon >= -180 &&
    station.lon <= 180
  );
}

function cross(origin: LatLon, first: LatLon, second: LatLon): number {
  return (
    (first.lon - origin.lon) * (second.lat - origin.lat) -
    (first.lat - origin.lat) * (second.lon - origin.lon)
  );
}

function uniqueSortedPoints(stations: Station[]): LatLon[] {
  const unique = new Map<string, LatLon>();

  for (const station of stations) {
    if (!isValidPoint(station)) continue;
    unique.set(`${station.lat}:${station.lon}`, { lat: station.lat, lon: station.lon });
  }

  return [...unique.values()].sort((first, second) =>
    first.lon === second.lon ? first.lat - second.lat : first.lon - second.lon,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function computeStationServiceArea(stations: Station[]): StationServiceArea | null {
  const points = uniqueSortedPoints(stations);
  if (points.length === 0) return null;

  let west = points[0].lon;
  let east = points[0].lon;
  let north = points[0].lat;
  let south = points[0].lat;
  for (const point of points.slice(1)) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
  }

  const latitudePadding = MAX_STATION_DISTANCE_MILES / 69;
  const maximumAbsoluteLatitude = Math.max(Math.abs(north), Math.abs(south));
  const longitudeMilesPerDegree = Math.max(
    0.01,
    69 * Math.cos((maximumAbsoluteLatitude * Math.PI) / 180),
  );
  const longitudePadding = MAX_STATION_DISTANCE_MILES / longitudeMilesPerDegree;
  const bounds = {
    west: clamp(west - longitudePadding, -180, 180),
    north: clamp(north + latitudePadding, -90, 90),
    east: clamp(east + longitudePadding, -180, 180),
    south: clamp(south - latitudePadding, -90, 90),
  };
  const cacheKey = points.map((point) => `${point.lat},${point.lon}`).join(';');

  return { bounds, points, cacheKey };
}

export function computeStationCoverageHull(stations: Station[]): LatLon[] {
  const points = uniqueSortedPoints(stations);
  if (points.length < 3) return points;

  const lower: LatLon[] = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: LatLon[] = [];
  for (const point of [...points].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  const counterClockwise = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [counterClockwise[0], ...counterClockwise.slice(1).reverse()];
}

export function hasStationServiceArea(stations: Station[]): boolean {
  return computeStationServiceArea(stations) !== null;
}

export function isWithinStationServiceArea(stations: Station[], point: LatLon): boolean {
  const serviceArea = computeStationServiceArea(stations);
  return serviceArea !== null && isPointWithinStationServiceArea(serviceArea, point);
}

export function isPointWithinStationServiceArea(
  serviceArea: StationServiceArea,
  point: LatLon,
): boolean {
  return serviceArea.points.some(
    (stationPoint) => kmToMiles(haversineKm(point, stationPoint)) <= MAX_STATION_DISTANCE_MILES,
  );
}
