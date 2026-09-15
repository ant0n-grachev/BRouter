import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceLocation } from './useDeviceLocation';

class FakeCoordinates implements GeolocationCoordinates {
  readonly accuracy = 5;
  readonly altitude = null;
  readonly altitudeAccuracy = null;
  readonly heading = null;
  readonly latitude: number;
  readonly longitude: number;
  readonly speed = null;
  readonly toJSON = () => ({});

  constructor(latitude: number, longitude: number) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

class FakePosition implements GeolocationPosition {
  readonly coords: GeolocationCoordinates;
  readonly timestamp = Date.now();
  readonly toJSON = () => ({});

  constructor(latitude: number, longitude: number) {
    this.coords = new FakeCoordinates(latitude, longitude);
  }
}

class FakePositionError implements GeolocationPositionError {
  readonly PERMISSION_DENIED = 1;
  readonly POSITION_UNAVAILABLE = 2;
  readonly TIMEOUT = 3;
  readonly code: number;
  readonly message = 'browser-only detail';

  constructor(code: number) {
    this.code = code;
  }
}

interface LocationRequest {
  success: PositionCallback;
  error: PositionErrorCallback | null | undefined;
  options: PositionOptions | undefined;
}

class FakeGeolocation implements Geolocation {
  readonly requests: LocationRequest[] = [];
  private nextWatchId = 1;

  getCurrentPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): void {
    this.requests.push({ success, error, options });
  }

  watchPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number {
    this.requests.push({ success, error, options });
    return this.nextWatchId++;
  }

  clearWatch(): void {}

  succeed(request: number, latitude: number, longitude: number): void {
    this.requests[request]?.success(new FakePosition(latitude, longitude));
  }

  fail(request: number, code: number): void {
    this.requests[request]?.error?.(new FakePositionError(code));
  }
}

let originalGeolocation: PropertyDescriptor | undefined;
let geolocation: FakeGeolocation;

function setGeolocation(value: Geolocation | undefined): void {
  if (value) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value,
    });
    return;
  }

  Reflect.deleteProperty(navigator, 'geolocation');
}

beforeEach(() => {
  originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  geolocation = new FakeGeolocation();
  setGeolocation(geolocation);
});

afterEach(() => {
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    setGeolocation(undefined);
  }
});

describe('useDeviceLocation', () => {
  it('reports a successful location to the caller from the browser callback', () => {
    const onLocation = vi.fn();
    const { result } = renderHook(() => useDeviceLocation({ enabled: true, onLocation }));

    act(() => {
      geolocation.succeed(0, 43.0731, -89.4012);
    });

    expect(onLocation).toHaveBeenCalledOnce();
    expect(onLocation).toHaveBeenCalledWith({ lat: 43.0731, lon: -89.4012 });
    expect(result.current.status).toBe('ready');
  });

  it('starts one request per activation even when the caller rerenders', () => {
    const { rerender } = renderHook(({ enabled }) => useDeviceLocation({ enabled }), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: true });

    expect(geolocation.requests).toHaveLength(1);
  });

  it.each([
    [1, 'permission-denied', 'Location permission was denied. Please enter an address instead.'],
    [2, 'unavailable', 'Your location is currently unavailable. Please try again.'],
    [3, 'timeout', 'Location request timed out. Please try again.'],
    [999, 'unavailable', 'Your location is currently unavailable. Please try again.'],
  ])('maps browser error code %i to a friendly %s error', (code, category, message) => {
    const { result } = renderHook(() => useDeviceLocation({ enabled: true }));

    act(() => {
      geolocation.fail(0, code);
    });

    expect(result.current).toMatchObject({
      error: { category, message },
      loading: false,
      requested: true,
      status: 'error',
    });
  });

  it('reports an unsupported browser without exposing a raw browser error', () => {
    setGeolocation(undefined);

    const { result } = renderHook(() => useDeviceLocation({ enabled: true }));

    expect(result.current).toMatchObject({
      error: {
        category: 'unsupported',
        message: 'Location is not supported by this browser.',
      },
      loading: false,
      status: 'error',
    });
  });

  it('ignores a browser callback that arrives after device mode is disabled', () => {
    const { result, rerender } = renderHook(({ enabled }) => useDeviceLocation({ enabled }), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: false });
    act(() => {
      geolocation.succeed(0, 43.5, -89.5);
    });

    expect(result.current).toMatchObject({
      location: null,
      loading: false,
      requested: false,
      error: null,
      status: 'idle',
    });
  });

  it('ignores a browser callback that arrives after unmount', () => {
    const { result, unmount } = renderHook(() => useDeviceLocation({ enabled: true }));

    unmount();
    act(() => {
      geolocation.fail(0, 1);
    });

    expect(result.current.location).toBeNull();
  });

  it('starts a fresh request when retrying after an error', () => {
    const { result } = renderHook(() => useDeviceLocation({ enabled: true }));

    act(() => {
      geolocation.fail(0, 2);
    });
    act(() => {
      result.current.retry();
    });

    expect(geolocation.requests).toHaveLength(2);
    expect(result.current).toMatchObject({
      error: null,
      loading: true,
      requested: true,
      status: 'loading',
    });
  });
});
