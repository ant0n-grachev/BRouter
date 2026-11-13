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

const east = (meters: number, north = 0) => ({
  lat: leg.from.lat + north / 111_195,
  lon: leg.from.lon + meters / (111_195 * Math.cos((leg.from.lat * Math.PI) / 180)),
});

function loopRoute(points: Array<[number, number]>, distanceMeters: number): RoutedPath {
  const geometry = points.map(([x, y]) => east(x, y));
  return {
    geometry,
    distanceMeters,
    durationSeconds: 120,
    instructions: [
      { text: 'Arrive', distanceMeters: 0, durationSeconds: 0, geometryIndex: geometry.length - 1 },
    ],
  };
}

const crossingRoute = loopRoute(
  [
    [0, 0],
    [100, 0],
    [100, 100],
    [50, 100],
    [50, 0],
  ],
  350,
);

function replay(activeRoute: RoutedPath) {
  const currentLeg = { ...leg, to: activeRoute.geometry.at(-1)! };
  const timestamp = Date.now();
  const fix = (x: number, y: number, accuracy = 5) => ({
    ...east(x, y),
    accuracy,
    heading: null,
    timestamp,
  });
  vi.mocked(fetchRoute).mockResolvedValue(activeRoute);
  const initialProps: { position: LocationFix | null; selectedLeg: TripLeg } = {
    position: fix(0, 0),
    selectedLeg: currentLeg,
  };
  const hook = renderHook(
    ({ position, selectedLeg }) => useRoutedNavigation(selectedLeg, position, true),
    { initialProps },
  );
  return {
    ...hook,
    currentLeg,
    update: (x: number, y: number, accuracy = 5) =>
      hook.rerender({ position: fix(x, y, accuracy), selectedLeg: currentLeg }),
    lose: () => hook.rerender({ position: null, selectedLeg: currentLeg }),
    remaining: () => hook.result.current.progress?.remainingDistanceMeters,
  };
}

it('keeps the later traversal when a leg ends at an earlier segment and survives losing fixes', async () => {
  const run = replay(crossingRoute);
  await waitFor(() => expect(run.result.current.route).toBe(crossingRoute));
  run.update(50, 0);
  expect(run.remaining()).toBeCloseTo(300, 0);
  run.update(100, 0);
  run.update(100, 100);
  run.update(50, 100);
  run.update(50, 30);
  expect(run.remaining()).toBeCloseTo(30, 0);
  run.update(50, 0, 70);
  run.lose();
  expect(run.remaining()).toBe(350);
  run.update(50, 0);
  expect(run.remaining()).toBeCloseTo(0, 0);
  expect(fetchRoute).toHaveBeenCalledTimes(1);
});

it('starts conservatively at a repeated coordinate after a same-endpoint reroute', async () => {
  const run = replay(crossingRoute);
  await waitFor(() => expect(run.result.current.route).toBe(crossingRoute));
  run.update(100, 0);
  run.update(100, 100);
  run.update(50, 100);
  run.update(50, 30);
  run.update(50, 0);
  expect(run.remaining()).toBeCloseTo(0, 0);
  act(() => run.result.current.retry());
  await waitFor(() => expect(run.remaining()).toBeCloseTo(300, 0));
  expect(fetchRoute).toHaveBeenCalledTimes(2);
});

it('requests a different leg even when its mode and endpoints are identical', async () => {
  const run = replay(crossingRoute);
  await waitFor(() => expect(run.result.current.route).toBe(crossingRoute));
  const newRoute = { ...crossingRoute, distanceMeters: 500 };
  vi.mocked(fetchRoute).mockResolvedValue(newRoute);
  run.rerender({
    position: null,
    selectedLeg: { ...run.currentLeg, title: 'Walk to destination' },
  });
  await waitFor(() => expect(run.result.current.route).toBe(newRoute));
});

it('ignores a superseded response after retrying with the same endpoints', async () => {
  let finishOld: (route: RoutedPath) => void = () => undefined;
  vi.mocked(fetchRoute).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const newRoute = { ...route, distanceMeters: 220 };
  vi.mocked(fetchRoute).mockResolvedValue(newRoute);
  const { result } = renderHook(() => useRoutedNavigation(leg, null, true));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.route).toBe(newRoute));
  await act(async () => {
    finishOld(route);
    await Promise.resolve();
  });
  expect(result.current.route).toBe(newRoute);
});

it('stays on the current traversal with noisy fixes between parallel paths and permits backtracking', async () => {
  const retraced = loopRoute(
    [
      [0, 0],
      [120, 0],
      [120, 8],
      [0, 8],
    ],
    248,
  );
  const run = replay(retraced);
  await waitFor(() => expect(run.result.current.route).toBe(retraced));
  run.update(30, 5, 10);
  expect(run.remaining()).toBeCloseTo(218, 0);
  run.update(60, 6, 10);
  expect(run.remaining()).toBeCloseTo(188, 0);
  run.update(45, 6, 10);
  expect(run.remaining()).toBeCloseTo(203, 0);
  run.update(120, 0);
  run.update(120, 8);
  run.update(90, 3, 10);
  expect(run.remaining()).toBeCloseTo(90, 0);
  run.update(105, 3, 10);
  expect(run.remaining()).toBeCloseTo(105, 0);
  run.update(0, 8);
  expect(run.remaining()).toBeCloseTo(0, 0);
});

it('uses observed forward movement to follow an exactly retraced path after the turn', async () => {
  const retraced = loopRoute(
    [
      [0, 0],
      [120, 0],
      [0, 0],
    ],
    240,
  );
  const run = replay(retraced);
  await waitFor(() => expect(run.result.current.route).toBe(retraced));
  expect(run.remaining()).toBeCloseTo(240, 0);
  run.update(60, 0);
  run.update(120, 0);
  run.update(80, 0);
  expect(run.remaining()).toBeCloseTo(80, 0);
  run.update(0, 0);
  expect(run.remaining()).toBeCloseTo(0, 0);
});

it('follows both traversals of an exact retrace with five-meter fixes and ten-meter accuracy', async () => {
  const activeRoute: RoutedPath = {
    ...crossingRoute,
    geometry: [
      { lat: 0, lon: 0 },
      { lat: 100 / 111194.92664455874, lon: 0 },
      { lat: 0, lon: 0 },
    ],
    distanceMeters: 200,
  };
  vi.mocked(fetchRoute).mockResolvedValue(activeRoute);
  const currentLeg = { ...leg, from: activeRoute.geometry[0], to: activeRoute.geometry[2] };
  const position = (meters: number) => ({
    lat: meters / 111194.92664455874,
    lon: 0,
    accuracy: 10,
    heading: null,
    timestamp: Date.now(),
  });
  const { rerender, result } = renderHook(({ fix }) => useRoutedNavigation(currentLeg, fix, true), {
    initialProps: { fix: position(0) },
  });
  await waitFor(() => expect(result.current.route).toBe(activeRoute));
  for (let meters = 5; meters <= 100; meters += 5) {
    rerender({ fix: position(meters) });
    expect(result.current.progress?.remainingDistanceMeters).toBeCloseTo(200 - meters, 0);
  }
  for (let meters = 95; meters >= 0; meters -= 5) {
    rerender({ fix: position(meters) });
    expect(result.current.progress?.remainingDistanceMeters).toBeCloseTo(meters, 0);
  }
});

it('follows an exact retrace when accurate-enough fixes straddle the turn vertex', async () => {
  const retraced = loopRoute(
    [
      [0, 0],
      [100, 0],
      [0, 0],
    ],
    200,
  );
  const run = replay(retraced);
  await waitFor(() => expect(run.result.current.route).toBe(retraced));
  for (const meters of [25, 50, 75, 90, 96, 98]) {
    run.update(meters, 0, 10);
    expect(run.remaining()).toBeCloseTo(200 - meters, 0);
  }
  for (const meters of [94, 89, 80, 50, 0]) {
    run.update(meters, 0, 10);
    expect(run.remaining()).toBeCloseTo(meters, 0);
  }
});
