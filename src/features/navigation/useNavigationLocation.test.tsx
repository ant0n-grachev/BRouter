import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationLocation } from './useNavigationLocation';
import { useScreenAwake } from './useScreenAwake';

interface WatchRequest {
  id: number;
  success: PositionCallback;
  error: PositionErrorCallback | null | undefined;
  options: PositionOptions | undefined;
}

class FakeGeolocation implements Geolocation {
  readonly requests: WatchRequest[] = [];
  readonly cleared: number[] = [];
  private nextId = 1;

  getCurrentPosition(): void {}

  watchPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number {
    const id = this.nextId++;
    this.requests.push({ id, success, error, options });
    return id;
  }

  clearWatch(id: number): void {
    this.cleared.push(id);
  }

  succeed(
    requestIndex: number,
    coordinates: {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      heading?: number | null;
      timestamp?: number;
    } = {},
  ): void {
    const coords = {
      latitude: 43.0731,
      longitude: -89.4012,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      heading: 125,
      speed: null,
      toJSON: () => ({}),
      ...coordinates,
    } satisfies GeolocationCoordinates;
    this.requests[requestIndex]?.success({
      coords,
      timestamp: coordinates.timestamp ?? 123_456,
      toJSON: () => ({}),
    });
  }

  fail(requestIndex: number, code: number): void {
    this.requests[requestIndex]?.error?.({
      code,
      message: 'browser-only detail',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
  }
}

class FakePermissionStatus extends EventTarget implements PermissionStatus {
  readonly name: PermissionName = 'geolocation';
  onchange: ((this: PermissionStatus, event: Event) => unknown) | null = null;

  constructor(public state: PermissionState) {
    super();
  }

  change(state: PermissionState): void {
    this.state = state;
    this.dispatchEvent(new Event('change'));
  }
}

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const originalWakeLock = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
let geolocation: FakeGeolocation;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function show(): void {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

function hide(): void {
  setVisibility('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  geolocation = new FakeGeolocation();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
  setVisibility('visible');
});

afterEach(() => {
  if (originalGeolocation) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, 'geolocation');
  }
  if (originalPermissions) {
    Object.defineProperty(navigator, 'permissions', originalPermissions);
  } else {
    Reflect.deleteProperty(navigator, 'permissions');
  }
  if (originalVisibilityState) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityState);
  } else {
    Reflect.deleteProperty(document, 'visibilityState');
  }
  if (originalWakeLock) {
    Object.defineProperty(navigator, 'wakeLock', originalWakeLock);
  } else {
    Reflect.deleteProperty(navigator, 'wakeLock');
  }
});

describe('useNavigationLocation', () => {
  function setPermission(state: PermissionState): FakePermissionStatus {
    const status = new FakePermissionStatus(state);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue(status) },
    });
    return status;
  }

  it('stays manual for a prompt permission until retry explicitly requests location', async () => {
    setPermission('prompt');
    const { result } = renderHook(() => useNavigationLocation(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(geolocation.requests).toHaveLength(0);
    expect(result.current).toMatchObject({ fix: null, error: null });

    act(() => result.current.retry());
    expect(geolocation.requests).toHaveLength(1);
    expect(result.current.loading).toBe(true);
  });

  it('starts watching automatically when location permission is already granted', async () => {
    setPermission('granted');
    const { result } = renderHook(() => useNavigationLocation(true));

    await waitFor(() => expect(geolocation.requests).toHaveLength(1));
    expect(result.current.loading).toBe(true);
  });

  it('clears the fix and stops watching when location permission is revoked', async () => {
    const permission = setPermission('granted');
    const { result } = renderHook(() => useNavigationLocation(true));
    await waitFor(() => expect(geolocation.requests).toHaveLength(1));
    act(() => geolocation.succeed(0));
    expect(result.current.fix).not.toBeNull();

    act(() => permission.change('denied'));

    expect(geolocation.cleared).toEqual([1]);
    expect(geolocation.requests).toHaveLength(1);
    expect(result.current).toMatchObject({ fix: null, error: null, loading: false });
  });

  it('does not access geolocation until the journey becomes active, then exposes the full fix', async () => {
    setPermission('granted');
    const queryPermission = vi.spyOn(navigator.permissions, 'query');
    const { result, rerender } = renderHook(({ active }) => useNavigationLocation(active), {
      initialProps: { active: false },
    });

    expect(queryPermission).not.toHaveBeenCalled();
    expect(geolocation.requests).toHaveLength(0);
    expect(result.current).toMatchObject({ fix: null, error: null, loading: false });

    rerender({ active: true });
    await waitFor(() =>
      expect(queryPermission).toHaveBeenCalledExactlyOnceWith({ name: 'geolocation' }),
    );
    await waitFor(() => expect(geolocation.requests).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    expect(geolocation.requests[0]?.options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });

    act(() => geolocation.succeed(0));
    expect(result.current).toMatchObject({
      fix: {
        lat: 43.0731,
        lon: -89.4012,
        accuracy: 8,
        timestamp: 123_456,
        heading: 125,
      },
      error: null,
      loading: false,
    });
  });

  it('releases on hide, ignores the old callback, and reacquires on return', () => {
    const { result } = renderHook(() => useNavigationLocation(true));

    act(hide);
    expect(geolocation.cleared).toEqual([1]);
    act(() => geolocation.succeed(0, { latitude: 1, longitude: 2 }));
    expect(result.current.fix).toBeNull();

    act(show);
    expect(geolocation.requests).toHaveLength(2);
    act(() => geolocation.succeed(1, { latitude: 43.1, longitude: -89.3, heading: Number.NaN }));
    expect(result.current.fix).toMatchObject({ lat: 43.1, lon: -89.3, heading: null });
  });

  it('retry replaces the current watch and late callbacks cannot replace the new fix', () => {
    const { result } = renderHook(() => useNavigationLocation(true));

    act(() => result.current.retry());
    expect(geolocation.cleared).toEqual([1]);
    expect(geolocation.requests).toHaveLength(2);

    act(() => geolocation.succeed(1, { latitude: 43.2 }));
    act(() => geolocation.succeed(0, { latitude: 0 }));
    expect(result.current.fix?.lat).toBe(43.2);
  });

  it('uses friendly errors and can recover with retry', () => {
    const { result } = renderHook(() => useNavigationLocation(true));

    act(() => geolocation.fail(0, 1));
    expect(result.current.error).toMatch(/permission/i);
    expect(result.current.loading).toBe(false);

    act(() => result.current.retry());
    expect(result.current).toMatchObject({ error: null, loading: true });
  });

  it('clears a previous fix when location permission is denied', () => {
    const { result } = renderHook(() => useNavigationLocation(true));
    act(() => geolocation.succeed(0));
    expect(result.current.fix).not.toBeNull();

    act(() => geolocation.fail(0, 1));

    expect(result.current.fix).toBeNull();
    expect(result.current.error).toMatch(/permission/i);
  });

  it('retains a previous fix after a transient location timeout', () => {
    const { result } = renderHook(() => useNavigationLocation(true));
    act(() => geolocation.succeed(0));
    const previousFix = result.current.fix;

    act(() => geolocation.fail(0, 3));

    expect(result.current.fix).toBe(previousFix);
    expect(result.current.error).toMatch(/timed out/i);
  });

  it('clears a previous fix when location becomes unsupported', () => {
    const { result } = renderHook(() => useNavigationLocation(true));
    act(() => geolocation.succeed(0));
    expect(result.current.fix).not.toBeNull();

    Reflect.deleteProperty(navigator, 'geolocation');
    act(() => result.current.retry());

    expect(result.current.fix).toBeNull();
    expect(result.current.error).toMatch(/not supported/i);
    expect(result.current.loading).toBe(false);
  });

  it('clears its watch on unmount', () => {
    const { unmount } = renderHook(() => useNavigationLocation(true));
    unmount();
    expect(geolocation.cleared).toEqual([1]);
  });
});

describe('useScreenAwake', () => {
  it('holds a screen wake lock only while active and visible', async () => {
    const first = { release: vi.fn().mockResolvedValue(undefined) };
    const second = { release: vi.fn().mockResolvedValue(undefined) };
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });

    const { rerender, unmount } = renderHook(({ active }) => useScreenAwake(active), {
      initialProps: { active: true },
    });
    await act(async () => Promise.resolve());
    expect(request).toHaveBeenCalledWith('screen');

    act(hide);
    expect(first.release).toHaveBeenCalledOnce();

    act(show);
    await act(async () => Promise.resolve());
    expect(request).toHaveBeenCalledTimes(2);

    rerender({ active: false });
    expect(second.release).toHaveBeenCalledOnce();
    unmount();
  });

  it('releases a request that resolves after the journey ends', async () => {
    let resolveRequest!: (sentinel: { release: () => Promise<void> }) => void;
    const pending = new Promise<{ release: () => Promise<void> }>((resolve) => {
      resolveRequest = resolve;
    });
    const lateSentinel = { release: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockReturnValue(pending) },
    });

    const { rerender } = renderHook(({ active }) => useScreenAwake(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    await act(async () => {
      resolveRequest(lateSentinel);
      await pending;
    });

    expect(lateSentinel.release).toHaveBeenCalledOnce();
  });

  it('tolerates unsupported and rejected wake locks', async () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    const first = renderHook(() => useScreenAwake(true));
    first.unmount();

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const second = renderHook(() => useScreenAwake(true));
    await act(async () => Promise.resolve());
    second.unmount();
  });
});
