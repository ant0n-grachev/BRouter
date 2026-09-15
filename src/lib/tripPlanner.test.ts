import type { Station } from '../types';
import { createTripPlan } from './tripPlanner';

function station(overrides: Partial<Station>): Station {
  return {
    station_id: 'station',
    name: 'Station',
    lat: 43.0731,
    lon: -89.4012,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 3,
    num_docks_available: 4,
    ...overrides,
  };
}

describe('createTripPlan', () => {
  it('builds three independently actionable legs for the selected stations', () => {
    const plan = createTripPlan(
      { lat: 43.0731, lon: -89.4012 },
      { lat: 43.0805, lon: -89.3905, label: 'Destination' },
      station({ station_id: 'pickup', name: 'Pickup' }),
      station({
        station_id: 'dropoff',
        name: 'Dropoff',
        lat: 43.0804,
        lon: -89.3904,
      }),
    );

    expect(plan.legs.map((leg) => leg.title)).toEqual([
      'Walk to pickup',
      'Ride to dropoff',
      'Walk to destination',
    ]);
    expect(plan.legs.map((leg) => leg.mode)).toEqual(['walking', 'bicycling', 'walking']);
    expect(plan.legs.map((leg) => leg.fromDescription)).toEqual([
      'Current location',
      'Pickup',
      'Dropoff',
    ]);
    expect(plan.legs.map((leg) => leg.toDescription)).toEqual(['Pickup', 'Dropoff', 'Destination']);
    expect(plan.legs.every((leg) => !('url' in leg))).toBe(true);
    expect(plan.legs.every((leg) => Number.isFinite(leg.distanceMi))).toBe(true);
  });
});
