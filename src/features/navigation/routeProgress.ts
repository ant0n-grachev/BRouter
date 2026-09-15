import type { LatLon } from '../../types';
import type { RouteInstruction, RoutedPath } from './routingTypes';

const EARTH_RADIUS_METERS = 6_371_000;
const INSTRUCTION_REACHED_TOLERANCE_METERS = 1;

export interface RouteProgress {
  distanceFromRouteMeters: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  nextInstruction: RouteInstruction | null;
  distanceToInstructionMeters: number;
  geometryIndex: number;
}

interface Projection {
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  geometryIndex: number;
}

function toLocalMeters(point: LatLon, origin: LatLon, referenceLatitude: number) {
  const radians = Math.PI / 180;

  return {
    x: (point.lon - origin.lon) * radians * EARTH_RADIUS_METERS * Math.cos(referenceLatitude),
    y: (point.lat - origin.lat) * radians * EARTH_RADIUS_METERS,
  };
}

function distanceMeters(from: LatLon, to: LatLon): number {
  const referenceLatitude = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const local = toLocalMeters(to, from, referenceLatitude);
  return Math.hypot(local.x, local.y);
}

function cumulativeDistances(geometry: LatLon[]): number[] {
  const distances = [0];

  for (let index = 1; index < geometry.length; index += 1) {
    distances.push(distances[index - 1] + distanceMeters(geometry[index - 1], geometry[index]));
  }

  return distances;
}

function projectOntoRoute(geometry: LatLon[], distances: number[], position: LatLon): Projection {
  if (geometry.length === 0) {
    return { distanceFromRouteMeters: 0, distanceAlongRouteMeters: 0, geometryIndex: 0 };
  }

  if (geometry.length === 1) {
    return {
      distanceFromRouteMeters: distanceMeters(position, geometry[0]),
      distanceAlongRouteMeters: 0,
      geometryIndex: 0,
    };
  }

  let closest: Projection | null = null;

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    const referenceLatitude = ((start.lat + end.lat + position.lat) / 3) * (Math.PI / 180);
    const segment = toLocalMeters(end, start, referenceLatitude);
    const relativePosition = toLocalMeters(position, start, referenceLatitude);
    const squaredLength = segment.x * segment.x + segment.y * segment.y;
    const fraction =
      squaredLength === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (relativePosition.x * segment.x + relativePosition.y * segment.y) / squaredLength,
            ),
          );
    const offsetX = relativePosition.x - segment.x * fraction;
    const offsetY = relativePosition.y - segment.y * fraction;
    const distanceFromRouteMeters = Math.hypot(offsetX, offsetY);
    const projection = {
      distanceFromRouteMeters,
      distanceAlongRouteMeters:
        distances[index] + (distances[index + 1] - distances[index]) * fraction,
      geometryIndex: index,
    };

    if (!closest || projection.distanceFromRouteMeters < closest.distanceFromRouteMeters) {
      closest = projection;
    }
  }

  return closest!;
}

function instructionDistance(instruction: RouteInstruction, cumulative: number[]): number {
  if (cumulative.length === 0) return 0;

  const index = Math.max(0, Math.min(cumulative.length - 1, instruction.geometryIndex));
  return cumulative[index];
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getRouteProgress(route: RoutedPath, position: LatLon | null): RouteProgress {
  const cumulative = cumulativeDistances(route.geometry);
  const geometryDistance = cumulative.at(-1) ?? 0;
  const projection = position
    ? projectOntoRoute(route.geometry, cumulative, position)
    : { distanceFromRouteMeters: 0, distanceAlongRouteMeters: 0, geometryIndex: 0 };
  const progressFraction =
    geometryDistance > 0
      ? Math.max(0, Math.min(1, projection.distanceAlongRouteMeters / geometryDistance))
      : 0;
  const nextInstruction =
    route.instructions.find(
      (instruction) =>
        instructionDistance(instruction, cumulative) >=
        projection.distanceAlongRouteMeters - INSTRUCTION_REACHED_TOLERANCE_METERS,
    ) ?? null;

  return {
    distanceFromRouteMeters: finiteNonNegative(projection.distanceFromRouteMeters),
    remainingDistanceMeters: finiteNonNegative(route.distanceMeters) * (1 - progressFraction),
    remainingDurationSeconds: finiteNonNegative(route.durationSeconds) * (1 - progressFraction),
    nextInstruction,
    distanceToInstructionMeters: nextInstruction
      ? Math.max(
          0,
          instructionDistance(nextInstruction, cumulative) - projection.distanceAlongRouteMeters,
        )
      : 0,
    geometryIndex: projection.geometryIndex,
  };
}
