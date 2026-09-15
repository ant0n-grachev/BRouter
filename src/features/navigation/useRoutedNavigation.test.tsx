import { act, renderHook, waitFor } from '@testing-library/react';
import type { TripLeg } from '../../lib/tripPlanner';
import { fetchRoute } from './routingClient';
import type { RoutedPath } from './routingTypes';
import { useRoutedNavigation } from './useRoutedNavigation';
import type { LocationFix } from './navigationLocation';

vi.mock('./routingClient', () => ({ fetchRoute: vi.fn() }));

const leg: TripLeg = {
  title: 'Walk to pickup',
  mode: 'walking',
  from: { lat: 43.07, lon: -89.4 },
  to: { lat: 43.071, lon: -89.4 },
  fromDescription: 'Origin',
  toDescription: 'Pickup',
  distanceMi: 0.1,
};
const route: RoutedPath = {
  geometry: [leg.from, leg.to],
  instructions: [
    { text: 'Head north.', distanceMeters: 110, durationSeconds: 100, geometryIndex: 0 },
  ],
  distanceMeters: 110,
  durationSeconds: 100,
};

beforeEach(() => vi.mocked(fetchRoute).mockReset());

it('ignores an old route response after the selected station changes', async () => {
  let finishOld: (route: RoutedPath) => void = () => undefined;
  vi.mocked(fetchRoute)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue({ ...route, distanceMeters: 220 });
  const { result, rerender } = renderHook(
    ({ currentLeg }) => useRoutedNavigation(currentLeg, null, true),
    { initialProps: { currentLeg: leg } },
  );
  rerender({ currentLeg: { ...leg, to: { lat: 43.072, lon: -89.4 } } });
  await waitFor(() => expect(result.current.route?.distanceMeters).toBe(220));
  await act(async () => {
    finishOld(route);
    await Promise.resolve();
  });
  expect(result.current.route?.distanceMeters).toBe(220);
});

it('updates progress along the route without spending another routing request', async () => {
  vi.mocked(fetchRoute).mockResolvedValue(route);
  const fix = { ...leg.from, accuracy: 5, timestamp: Date.now(), heading: null };
  const { result, rerender } = renderHook(
    ({ position }) => useRoutedNavigation(leg, position, true),
    { initialProps: { position: fix } },
  );
  await waitFor(() => expect(result.current.route).not.toBeNull());
  rerender({ position: { ...fix, lat: 43.0705 } });
  expect(result.current.progress?.remainingDistanceMeters).toBeCloseTo(55, 0);
  expect(fetchRoute).toHaveBeenCalledTimes(1);
});

it('reports a routing failure and retries without inventing route geometry', async () => {
  vi.mocked(fetchRoute)
    .mockRejectedValueOnce(new Error('Routing is temporarily unavailable.'))
    .mockResolvedValue(route);
  const { result } = renderHook(() => useRoutedNavigation(leg, null, true));
  await waitFor(() => expect(result.current.error).toBe('Routing is temporarily unavailable.'));
  expect(result.current.route).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.route).toEqual(route));
});

it('stops presenting the previous route when recalculating fails', async () => {
  vi.mocked(fetchRoute)
    .mockResolvedValueOnce(route)
    .mockRejectedValueOnce(new Error('Directions are unavailable.'));
  const { result } = renderHook(() => useRoutedNavigation(leg, null, true));
  await waitFor(() => expect(result.current.route).toEqual(route));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBe('Directions are unavailable.'));
  expect(result.current.route).toBeNull();
  expect(result.current.progress).toBeNull();
});

it('replaces a planned-origin route once when the first GPS fix is somewhere else', async () => {
  vi.mocked(fetchRoute).mockResolvedValue(route);
  const { result, rerender } = renderHook(
    ({ fix }: { fix: LocationFix | null }) => useRoutedNavigation(leg, fix, true),
    { initialProps: { fix: null as LocationFix | null } },
  );
  await waitFor(() => expect(result.current.route).not.toBeNull());
  rerender({
    fix: { lat: 43.0705, lon: -89.4, accuracy: 5, timestamp: Date.now(), heading: null },
  });
  await waitFor(() => expect(fetchRoute).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fetchRoute).mock.calls[1][0].from).toEqual({ lat: 43.0705, lon: -89.4 });
  rerender({
    fix: { lat: 43.0706, lon: -89.4, accuracy: 5, timestamp: Date.now(), heading: null },
  });
  expect(fetchRoute).toHaveBeenCalledTimes(2);
});
