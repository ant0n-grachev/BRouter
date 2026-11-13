import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { TripLeg } from '../../lib/tripPlanner';
import { haversineKm } from '../../lib/distance';
import type { LatLon } from '../../types';
import { isUsableFix, type LocationFix } from './navigationLocation';
import {
  getRouteProgress,
  matchRouteProgress,
  type MatchedRoutePosition,
  type RouteProgress,
} from './routeProgress';
import { fetchRoute } from './routingClient';
import type { RoutedPath } from './routingTypes';

interface RouteState {
  key: string;
  route: RoutedPath | null;
  loading: boolean;
  error: string | null;
}
interface ProgressHistory {
  route: RoutedPath;
  key: string;
  fix: LocationFix;
  match: MatchedRoutePosition | null;
  remainingGeometryMeters: number | null;
  progress: RouteProgress;
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
  legIdentity = '',
) {
  const [state, dispatch] = useReducer(routeReducer, {
    key: '',
    route: null,
    loading: false,
    error: null,
  });
  const [revision, requestAgain] = useReducer((value: number) => value + 1, 0);
  const [history, setHistory] = useState<ProgressHistory | null>(null);
  const latestPosition = useRef(position);
  const lastRequestAt = useRef(0);
  const requestedFromFix = useRef(false);
  const requestAnchor = useRef<LatLon | null>(null);
  useLayoutEffect(() => {
    latestPosition.current = position;
  }, [position]);
  const key = `${legIdentity}:${leg.title}:${leg.mode}:${leg.from.lat},${leg.from.lon}:${leg.to.lat},${leg.to.lon}:${revision}`;
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
  }, [key, fromLat, fromLon, toLat, toLon, mode, online, enabled]);

  const route = enabled && state.key === key ? state.route : null;
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
  const initialProgress = useMemo(() => (route ? getRouteProgress(route, null) : null), [route]);
  const currentHistory = history?.route === route && history.key === key ? history : null;
  let progress = initialProgress;
  let remainingGeometryMeters: number | null = null;
  if (route && usablePosition) {
    if (currentHistory?.fix === usablePosition) {
      progress = currentHistory.progress;
      remainingGeometryMeters = currentHistory.remainingGeometryMeters;
    } else {
      const match = matchRouteProgress(
        route,
        usablePosition,
        currentHistory?.match,
        usablePosition.accuracy,
      );
      const isOnRoute = match.progress.distanceFromRouteMeters <= 80 + usablePosition.accuracy;
      remainingGeometryMeters = isOnRoute ? (match.match?.remainingGeometryMeters ?? null) : null;
      setHistory({
        route,
        key,
        fix: usablePosition,
        progress: match.progress,
        match: isOnRoute ? match.match : (currentHistory?.match ?? null),
        remainingGeometryMeters,
      });
      progress = match.progress;
    }
  } else if (history && !currentHistory) {
    setHistory(null);
  }
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
    remainingGeometryMeters,
    loading,
    error: !online
      ? 'You’re offline. Route updates will resume when you reconnect.'
      : state.key === key
        ? state.error
        : null,
    retry,
  };
}
