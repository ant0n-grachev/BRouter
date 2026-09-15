import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { LocationFix } from './navigationLocation';

export interface NavigationLocationState {
  fix: LocationFix | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

interface LocationState {
  fix: LocationFix | null;
  error: string | null;
  loading: boolean;
}

type GeolocationPermissionMode = 'checking' | 'granted' | 'manual' | 'fallback';

const idleState: LocationState = { fix: null, error: null, loading: false };

type LocationStateAction = LocationState | ((current: LocationState) => LocationState);

function locationStateReducer(state: LocationState, action: LocationStateAction): LocationState {
  return typeof action === 'function' ? action(state) : action;
}

function friendlyLocationError(code: number): string {
  if (code === 1) return 'Location permission was denied. Allow location access and try again.';
  if (code === 3) return 'Finding your location timed out. Try again.';
  return 'Your location is unavailable right now. Try again.';
}

export function useNavigationLocation(active: boolean): NavigationLocationState {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [permissionMode, setPermissionMode] = useState<GeolocationPermissionMode>(() =>
    typeof navigator.permissions?.query === 'function' ? 'checking' : 'fallback',
  );
  const [state, dispatch] = useReducer(locationStateReducer, idleState);
  const activeRef = useRef(active);
  const visibleRef = useRef(visible);
  const requestGenerationRef = useRef(0);
  const handledRetryGenerationRef = useRef(0);

  useLayoutEffect(() => {
    activeRef.current = active;
    visibleRef.current = visible;
  }, [active, visible]);

  useEffect(() => {
    const handleVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!active) return;
    const permissions = navigator.permissions;
    if (typeof permissions?.query !== 'function') return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const syncPermission = () => {
      if (!cancelled && status) {
        setPermissionMode(status.state === 'granted' ? 'granted' : 'manual');
      }
    };

    void permissions.query({ name: 'geolocation' }).then(
      (nextStatus) => {
        if (cancelled) return;
        status = nextStatus;
        syncPermission();
        status.addEventListener('change', syncPermission);
      },
      () => {
        if (!cancelled) setPermissionMode('fallback');
      },
    );

    return () => {
      cancelled = true;
      status?.removeEventListener('change', syncPermission);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      requestGenerationRef.current += 1;
      dispatch(idleState);
      return;
    }

    const explicitlyRequested = retryGeneration > handledRetryGenerationRef.current;
    const permissionAllowsWatch =
      permissionMode === 'granted' || permissionMode === 'fallback' || explicitlyRequested;
    if (!permissionAllowsWatch) {
      requestGenerationRef.current += 1;
      dispatch((current) => ({ ...current, fix: null, loading: false }));
      return;
    }

    if (!visible) {
      requestGenerationRef.current += 1;
      dispatch((current) => ({ ...current, loading: false }));
      return;
    }

    if (explicitlyRequested) handledRetryGenerationRef.current = retryGeneration;

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const isCurrent = () =>
      activeRef.current && visibleRef.current && requestGenerationRef.current === requestGeneration;

    dispatch((current) => ({ ...current, error: null, loading: true }));

    const geolocation = navigator.geolocation;
    if (!geolocation) {
      dispatch({
        fix: null,
        error: 'Location is not supported by this browser.',
        loading: false,
      });
      return;
    }

    const watchId = geolocation.watchPosition(
      (position) => {
        if (!isCurrent()) return;
        dispatch({
          fix: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
            heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          },
          error: null,
          loading: false,
        });
      },
      (error) => {
        if (!isCurrent()) return;
        const permissionDenied = error.code === error.PERMISSION_DENIED;
        if (permissionDenied) setPermissionMode('manual');
        dispatch((current) => ({
          ...current,
          fix: permissionDenied ? null : current.fix,
          error: friendlyLocationError(error.code),
          loading: false,
        }));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
      geolocation.clearWatch(watchId);
    };
  }, [active, permissionMode, retryGeneration, visible]);

  const retry = useCallback(() => {
    if (!activeRef.current) return;
    setRetryGeneration((generation) => generation + 1);
  }, []);

  return { ...state, retry };
}
