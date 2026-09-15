import { describe, expect, it } from 'vitest';
import { getRouteProgress } from './routeProgress';
import type { RoutedPath } from './routingTypes';

const EQUATOR_ROUTE: RoutedPath = {
  geometry: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
  ],
  instructions: [
    { text: 'Head east', distanceMeters: 1_000, durationSeconds: 100, geometryIndex: 0 },
    { text: 'Arrive', distanceMeters: 0, durationSeconds: 0, geometryIndex: 1 },
  ],
  distanceMeters: 1_000,
  durationSeconds: 100,
};

describe('getRouteProgress', () => {
  it('returns the full route and first instruction before a position is available', () => {
    expect(getRouteProgress(EQUATOR_ROUTE, null)).toEqual({
      distanceFromRouteMeters: 0,
      remainingDistanceMeters: 1_000,
      remainingDurationSeconds: 100,
      nextInstruction: EQUATOR_ROUTE.instructions[0],
      distanceToInstructionMeters: 0,
      geometryIndex: 0,
    });
  });

  it('projects onto the nearest segment and scales provider totals by route progress', () => {
    const progress = getRouteProgress(EQUATOR_ROUTE, { lat: 0.001, lon: 0.004 });

    expect(progress.distanceFromRouteMeters).toBeCloseTo(111.2, 0);
    expect(progress.remainingDistanceMeters).toBeCloseTo(600, 0);
    expect(progress.remainingDurationSeconds).toBeCloseTo(60, 0);
    expect(progress.nextInstruction?.text).toBe('Arrive');
    expect(progress.distanceToInstructionMeters).toBeCloseTo(667.2, 0);
    expect(progress.geometryIndex).toBe(0);
  });

  it('selects the instruction at a reached geometry vertex before moving past it', () => {
    const route: RoutedPath = {
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.005 },
        { lat: 0, lon: 0.01 },
      ],
      instructions: [
        { text: 'Turn north', distanceMeters: 500, durationSeconds: 50, geometryIndex: 1 },
        { text: 'Arrive', distanceMeters: 0, durationSeconds: 0, geometryIndex: 2 },
      ],
      distanceMeters: 1_000,
      durationSeconds: 100,
    };

    expect(getRouteProgress(route, route.geometry[1]).nextInstruction?.text).toBe('Turn north');
    expect(getRouteProgress(route, { lat: 0, lon: 0.0075 }).nextInstruction?.text).toBe('Arrive');
  });

  it('returns finite values for duplicate and zero-length route coordinates', () => {
    const route: RoutedPath = {
      geometry: [
        { lat: 43.0731, lon: -89.4012 },
        { lat: 43.0731, lon: -89.4012 },
      ],
      instructions: [{ text: 'Arrive', distanceMeters: 0, durationSeconds: 0, geometryIndex: 1 }],
      distanceMeters: 25,
      durationSeconds: 5,
    };

    const progress = getRouteProgress(route, { lat: 43.0741, lon: -89.4012 });

    expect(progress).toMatchObject({
      remainingDistanceMeters: 25,
      remainingDurationSeconds: 5,
      nextInstruction: route.instructions[0],
      distanceToInstructionMeters: 0,
      geometryIndex: 0,
    });
    expect(Object.values(progress).filter((value) => typeof value === 'number')).toSatisfy(
      (values: number[]) => values.every(Number.isFinite),
    );
  });
});
