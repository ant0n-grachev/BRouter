import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { LatLon } from '../types';

export type DeviceLocationErrorCategory =
  'unsupported' | 'permission-denied' | 'timeout' | 'unavailable';

export interface DeviceLocationError {
  category: DeviceLocationErrorCategory;
  message: string;
}

export type DeviceLocationStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DeviceLocationState {
  location: LatLon | null;
  requested: boolean;
  loading: boolean;
  error: DeviceLocationError | null;
  status: DeviceLocationStatus;
}

type DeviceLocationAction =
  | { type: 'disabled' }
  | { type: 'request' }
  | { type: 'success'; location: LatLon }
  | { type: 'failure'; error: DeviceLocationError };

interface UseDeviceLocationOptions {
  enabled: boolean;
  onLocation?: (location: LatLon) => void;
}

const unsupportedError: DeviceLocationError = {
  category: 'unsupported',
  message: 'Location is not supported by this browser.',
};

const initialState: DeviceLocationState = {
  location: null,
  requested: false,
  loading: false,
  error: null,
  status: 'idle',
};

function deviceLocationReducer(
  state: DeviceLocationState,
  action: DeviceLocationAction,
): DeviceLocationState {
  switch (action.type) {
    case 'disabled':
      return initialState;
    case 'request':
      return {
        location: null,
        requested: true,
        loading: true,
        error: null,
        status: 'loading',
      };
    case 'success':
      return {
        ...state,
        location: action.location,
        loading: false,
        error: null,
        status: 'ready',
      };
    case 'failure':
      return {
        ...state,
        loading: false,
        error: action.error,
        status: 'error',
      };
  }
}

export function getDeviceLocationError(code: number): DeviceLocationError {
  switch (code) {
    case 1:
      return {
        category: 'permission-denied',
        message: 'Location permission was denied. Please enter an address instead.',
      };
    case 3:
      return {
        category: 'timeout',
        message: 'Location request timed out. Please try again.',
      };
    case 2:
    default:
      return {
        category: 'unavailable',
        message: 'Your location is currently unavailable. Please try again.',
      };
  }
}

export function useDeviceLocation({ enabled, onLocation }: UseDeviceLocationOptions) {
  const [state, dispatch] = useReducer(deviceLocationReducer, initialState);
  const [retryCount, setRetryCount] = useState(0);
  const enabledRef = useRef(enabled);
  const onLocationRef = useRef(onLocation);
  const requestGenerationRef = useRef(0);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    onLocationRef.current = onLocation;
  }, [enabled, onLocation]);

  const retry = useCallback(() => {
    if (!enabledRef.current) return;

    requestGenerationRef.current += 1;
    setRetryCount((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      requestGenerationRef.current += 1;
      dispatch({ type: 'disabled' });
      return;
    }

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      enabledRef.current && requestGenerationRef.current === requestGeneration;

    dispatch({ type: 'request' });

    if (!navigator.geolocation) {
      if (isCurrentRequest()) {
        dispatch({ type: 'failure', error: unsupportedError });
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!isCurrentRequest()) return;

        const location = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        dispatch({ type: 'success', location });
        onLocationRef.current?.(location);
      },
      (positionError) => {
        if (!isCurrentRequest()) return;

        dispatch({
          type: 'failure',
          error: getDeviceLocationError(positionError.code),
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );

    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
    };
  }, [enabled, retryCount]);

  return {
    ...state,
    retry,
  };
}
