import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { TripLeg } from '../../lib/tripPlanner';
import { haversineKm } from '../../lib/distance';
import type { LatLon } from '../../types';
import { isUsableFix, type LocationFix } from './navigationLocation';
import { getRouteProgress } from './routeProgress';
import { fetchRoute } from './routingClient';
import type { RoutedPath } from './routingTypes';

interface RouteState {
  key: string;
  route: RoutedPath | null;
  loading: boolean;
  error: string | null;
}
type RouteAction =
  | { type: 'request'; key: string }
  | { type: 'success'; key: string; route: RoutedPath }
  | { type: 'failure'; key: string; error: string };

function routeReducer(state: RouteState, action: RouteAction): RouteState {
  if (action.type === 'request') {
    return {
      key: action.key,
      route: null,
      loading: true,
      error: null,
    };
  }
  if (state.key !== action.key) return state;
  return action.type === 'success'
    ? { ...state, route: action.route, loading: false, error: null }
    : { ...state, loading: false, error: action.error };
}

export function useRoutedNavigation(
  leg: TripLeg,
  position: LocationFix | null,
  online: boolean,
  enabled = true,
) {
  const [state, dispatch] = useReducer(routeReducer, {
    key: '',
    route: null,
    loading: false,
    error: null,
  });
  const [revision, requestAgain] = useReducer((value: number) => value + 1, 0);
  const latestPosition = useRef(position);
  const lastRequestAt = useRef(0);
  const requestedFromFix = useRef(false);
  const requestAnchor = useRef<LatLon | null>(null);
  useLayoutEffect(() => {
    latestPosition.current = position;
  }, [position]);
  const key = `${leg.mode}:${leg.from.lat},${leg.from.lon}:${leg.to.lat},${leg.to.lon}`;
  const fromLat = leg.from.lat;
  const fromLon = leg.from.lon;
  const toLat = leg.to.lat;
  const toLon = leg.to.lon;
  const mode = leg.mode;

  useEffect(() => {
    if (!enabled || !online) return;
    const controller = new AbortController();
    const fix = latestPosition.current;
    requestedFromFix.current = isUsableFix(fix);
    const from =
      requestedFromFix.current && fix
        ? { lat: fix.lat, lon: fix.lon }
        : { lat: fromLat, lon: fromLon };
    requestAnchor.current = from;
    lastRequestAt.current = Date.now();
    dispatch({ type: 'request', key });
    void fetchRoute({ from, to: { lat: toLat, lon: toLon }, mode }, controller.signal).then(
      (route) => {
        if (!controller.signal.aborted) dispatch({ type: 'success', key, route });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          dispatch({
            type: 'failure',
            key,
            error:
              error instanceof Error
                ? error.message
                : 'Directions are unavailable. Please try again.',
          });
      },
    );
    return () => controller.abort();
  }, [key, fromLat, fromLon, toLat, toLon, mode, online, enabled, revision]);

  const route = state.key === key ? state.route : null;
  const usablePosition = isUsableFix(position) ? position : null;
  useEffect(() => {
    if (
      !enabled ||
      !online ||
      !usablePosition ||
      requestedFromFix.current ||
      !requestAnchor.current
    )
      return;
    requestedFromFix.current = true;
    if (haversineKm(usablePosition, requestAnchor.current) * 1000 > 30) requestAgain();
  }, [enabled, online, usablePosition, key]);
  const progress = useMemo(
    () => (route ? getRouteProgress(route, usablePosition) : null),
    [route, usablePosition],
  );
  const loading = enabled && online && (state.key !== key || state.loading);
  useEffect(() => {
    if (!enabled || !online || loading || state.error || !usablePosition || !progress) return;
    if (
      progress.distanceFromRouteMeters > 80 + usablePosition.accuracy &&
      Date.now() - lastRequestAt.current >= 15_000
    )
      requestAgain();
  }, [enabled, online, loading, state.error, usablePosition, progress]);
  const retry = useCallback(() => requestAgain(), []);
  return {
    route,
    progress,
    loading,
    error: !online
      ? 'You’re offline. Route updates will resume when you reconnect.'
      : state.key === key
        ? state.error
        : null,
    retry,
  };
}
