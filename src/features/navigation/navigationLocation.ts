import type { LatLon } from '../../types';
import { haversineKm } from '../../lib/distance';

export interface LocationFix extends LatLon {
  accuracy: number;
  timestamp: number;
  heading: number | null;
}

function hasValidCoordinates(point: LatLon): boolean {
  return (
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    Number.isFinite(point.lon) &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

export function isDisplayableFix(fix: LocationFix | null, now = Date.now()): boolean {
  return Boolean(
    fix &&
    hasValidCoordinates(fix) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    Number.isFinite(fix.timestamp) &&
    Number.isFinite(now) &&
    fix.timestamp - now <= 5_000 &&
    now - fix.timestamp <= 30_000,
  );
}

export function isUsableFix(fix: LocationFix | null, now = Date.now()): boolean {
  return Boolean(isDisplayableFix(fix, now) && fix && fix.accuracy <= 50);
}

export function isNearTarget(fix: LocationFix | null, target: LatLon, now = Date.now()): boolean {
  if (!isUsableFix(fix, now) || !fix || !hasValidCoordinates(target)) return false;

  return haversineKm(fix, target) * 1_000 + fix.accuracy <= 100;
}
