import type { LatLon } from '../types';

export function haversineKm(a: LatLon, b: LatLon) {
  const R = 6371.0088;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dphi = toRad(b.lat - a.lat);
  const dlambda = toRad(b.lon - a.lon);
  const A =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

export const kmToMiles = (km: number) => km * 0.621371;
export const milesToFeet = (mi: number) => mi * 5280;

export function fmtMilesFeet(mi: number) {
  if (mi < 0.25) return `${Math.round(milesToFeet(mi))} ft`;
  return `${mi.toFixed(2)} mi`;
}
