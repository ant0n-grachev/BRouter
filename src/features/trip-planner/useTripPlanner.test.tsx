import { act, renderHook } from '@testing-library/react';
import type { Station } from '../../types';
import { useTripPlanner } from './useTripPlanner';

function station(overrides: Partial<Station>): Station {
  return {
    station_id: 'station',
    name: 'Station',
    lat: 43,
    lon: -89,
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_bikes_available: 3,
    num_docks_available: 4,
    ...overrides,
  };
}

const candidates = [
  station({
    station_id: 'pickup-recommended',
    name: 'Pickup Recommended',
    lat: 43.0005,
    is_returning: false,
    num_bikes_available: 6,
    num_docks_available: 0,
  }),
  station({
    station_id: 'pickup-alternative',
    name: 'Pickup Alternative',
    lat: 43.001,
    is_returning: false,
    num_bikes_available: 3,
    num_docks_available: 0,
  }),
  station({
    station_id: 'dropoff-recommended',
    name: 'Drop-off Recommended',
    lat: 43.0052,
    is_renting: false,
    num_bikes_available: 0,
    num_docks_available: 7,
  }),
  station({
    station_id: 'dropoff-alternative',
    name: 'Drop-off Alternative',
    lat: 43.006,
    is_renting: false,
    num_bikes_available: 0,
    num_docks_available: 3,
  }),
];

const resetCandidates = [
  station({
    station_id: 'pickup-a',
    name: 'Pickup A',
    lat: 43.0005,
    is_returning: false,
    num_bikes_available: 3,
    num_docks_available: 0,
  }),
  station({
    station_id: 'pickup-b',
    name: 'Pickup B',
    lat: 43.0105,
    is_returning: false,
    num_bikes_available: 3,
    num_docks_available: 0,
  }),
  station({
    station_id: 'dropoff-a',
    name: 'Drop-off A',
    lat: 43.0205,
    is_renting: false,
    num_bikes_available: 0,
    num_docks_available: 3,
  }),
  station({
    station_id: 'dropoff-b',
    name: 'Drop-off B',
    lat: 43.0305,
    is_renting: false,
    num_bikes_available: 0,
    num_docks_available: 3,
  }),
];

describe('useTripPlanner', () => {
  it('clears resolved points and station selections together', () => {
    const { result } = renderHook(() => useTripPlanner(candidates));
    act(() => {
      result.current.setManualOrigin({ lat: 43, lon: -89 });
      result.current.setDestination({ lat: 43.005, lon: -89, label: 'Destination' });
      result.current.selectPickup('pickup-alternative');
      result.current.selectDropoff('dropoff-alternative');
    });
    expect(result.current.plan).not.toBeNull();
    expect(result.current.selectedPickup?.station.station_id).toBe('pickup-alternative');
    expect(result.current.selectedDropoff?.station.station_id).toBe('dropoff-alternative');

    act(() => result.current.clear());

    expect(result.current.originMode).toBe('manual');
    expect(result.current.origin).toBeNull();
    expect(result.current.destination).toBeNull();
    expect(result.current.selectedPickup).toBeNull();
    expect(result.current.selectedDropoff).toBeNull();
    expect(result.current.plan).toBeNull();
  });

  it('selects ranked defaults and immediately recomputes the itinerary for an alternative', () => {
    const { result } = renderHook(() => useTripPlanner(candidates));

    act(() => {
      result.current.setManualOrigin({ lat: 43, lon: -89 });
      result.current.setDestination({ lat: 43.005, lon: -89, label: 'Destination' });
    });

    expect(result.current.selectedPickup?.station.station_id).toBe('pickup-recommended');
    expect(result.current.selectedDropoff?.station.station_id).toBe('dropoff-recommended');
    expect(result.current.plan?.pickup.station_id).toBe('pickup-recommended');

    const originalPickupEndpoint = result.current.plan?.legs[0].to;
    act(() => result.current.selectPickup('pickup-alternative'));

    expect(result.current.selectedPickup?.station.station_id).toBe('pickup-alternative');
    expect(result.current.plan?.pickup.station_id).toBe('pickup-alternative');
    expect(result.current.plan?.legs[0].to).not.toEqual(originalPickupEndpoint);
    expect(result.current.plan?.legs[0].to).toEqual({
      lat: result.current.selectedPickup?.station.lat,
      lon: result.current.selectedPickup?.station.lon,
    });
  });

  it('clears the plan when editing invalidates a resolved location', () => {
    const { result } = renderHook(() => useTripPlanner(candidates));
    act(() => {
      result.current.setManualOrigin({ lat: 43, lon: -89 });
      result.current.setDestination({ lat: 43.005, lon: -89, label: 'Destination' });
    });
    expect(result.current.plan).not.toBeNull();

    act(() => result.current.setDestination(null));

    expect(result.current.plan).toBeNull();
    expect(result.current.dropoffCandidates).toEqual([]);
  });

  it('resets a chosen pickup to the closest station when the resolved origin changes', () => {
    const { result } = renderHook(() => useTripPlanner(resetCandidates));

    act(() => {
      result.current.setManualOrigin({ lat: 43, lon: -89 });
      result.current.selectPickup('pickup-a');
    });
    expect(result.current.selectedPickup?.station.station_id).toBe('pickup-a');

    act(() => result.current.setManualOrigin({ lat: 43.01, lon: -89 }));

    expect(result.current.selectedPickup?.station.station_id).toBe('pickup-b');
  });

  it('resets a chosen drop-off to the closest station when the resolved destination changes', () => {
    const { result } = renderHook(() => useTripPlanner(resetCandidates));

    act(() => {
      result.current.setManualOrigin({ lat: 43, lon: -89 });
      result.current.setDestination({ lat: 43.02, lon: -89, label: 'Destination A' });
      result.current.selectDropoff('dropoff-a');
    });
    expect(result.current.selectedDropoff?.station.station_id).toBe('dropoff-a');

    act(() => result.current.setDestination({ lat: 43.03, lon: -89, label: 'Destination B' }));

    expect(result.current.selectedDropoff?.station.station_id).toBe('dropoff-b');
  });

  it('distinguishes no bikes, all unavailable, and outside approximate coverage', () => {
    const noBikes = renderHook(() => useTripPlanner([station({ num_bikes_available: 0 })]));
    act(() => noBikes.result.current.setManualOrigin({ lat: 43, lon: -89 }));
    expect(noBikes.result.current.pickupIssue).toBe(
      'No bikes are currently available at installed rental stations.',
    );
    noBikes.unmount();

    const rentalDisabled = renderHook(() =>
      useTripPlanner([station({ is_renting: false, num_bikes_available: 4 })]),
    );
    act(() => rentalDisabled.result.current.setManualOrigin({ lat: 43, lon: -89 }));
    expect(rentalDisabled.result.current.pickupIssue).toBe(
      'No bikes are currently available at installed rental stations.',
    );
    rentalDisabled.unmount();

    const unavailable = renderHook(() => useTripPlanner([station({ is_installed: false })]));
    act(() => unavailable.result.current.setManualOrigin({ lat: 43, lon: -89 }));
    expect(unavailable.result.current.pickupIssue).toBe('All stations are currently unavailable.');
    unavailable.unmount();

    const outside = renderHook(() =>
      useTripPlanner([station({ lat: 44, lon: -89, num_bikes_available: 4 })]),
    );
    act(() => outside.result.current.setManualOrigin({ lat: 43, lon: -89 }));
    expect(outside.result.current.pickupIssue).toBe(
      'No pickup station is within 1.0 mile. This location is outside the approximate Madison BCycle station coverage.',
    );
  });
});
