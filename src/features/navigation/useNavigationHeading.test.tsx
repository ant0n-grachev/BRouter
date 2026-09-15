import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationHeading } from './useNavigationHeading';

interface OrientationValues {
  absolute?: boolean;
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

const originalDeviceOrientation = Object.getOwnPropertyDescriptor(
  globalThis,
  'DeviceOrientationEvent',
);
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const originalScreenOrientation = Object.getOwnPropertyDescriptor(screen, 'orientation');

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function setScreenAngle(angle: number): void {
  Object.defineProperty(screen, 'orientation', {
    configurable: true,
    value: { angle },
  });
}

function dispatchOrientation(
  type: 'deviceorientation' | 'deviceorientationabsolute',
  values: OrientationValues,
): void {
  const event = new Event(type);
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  window.dispatchEvent(event);
}

function setPermissionRequest(
  requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'>,
): void {
  Object.defineProperty(globalThis, 'DeviceOrientationEvent', {
    configurable: true,
    value: requestPermission ? { requestPermission } : {},
  });
}

beforeEach(() => {
  setVisibility('visible');
  setScreenAngle(0);
  setPermissionRequest();
});

afterEach(() => {
  if (originalDeviceOrientation) {
    Object.defineProperty(globalThis, 'DeviceOrientationEvent', originalDeviceOrientation);
  } else {
    Reflect.deleteProperty(globalThis, 'DeviceOrientationEvent');
  }
  if (originalVisibilityState) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityState);
  } else {
    Reflect.deleteProperty(document, 'visibilityState');
  }
  if (originalScreenOrientation) {
    Object.defineProperty(screen, 'orientation', originalScreenOrientation);
  } else {
    Reflect.deleteProperty(screen, 'orientation');
  }
});

describe('useNavigationHeading', () => {
  it('ignores relative alpha and derives north-referenced heading from absolute orientation', () => {
    setScreenAngle(90);
    const { result } = renderHook(() => useNavigationHeading(true));

    act(() => dispatchOrientation('deviceorientation', { absolute: false, alpha: 120 }));
    expect(result.current.heading).toBeNull();

    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 30 }));
    expect(result.current.heading).toBe(60);

    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 17.6 }));
    expect(result.current.heading).toBe(72);
  });

  it('uses the iOS compass heading and rejects an imprecise reading', () => {
    setScreenAngle(270);
    const { result } = renderHook(() => useNavigationHeading(true));

    act(() =>
      dispatchOrientation('deviceorientation', {
        alpha: 10,
        webkitCompassHeading: 275,
        webkitCompassAccuracy: 8,
      }),
    );
    expect(result.current.heading).toBe(185);

    act(() =>
      dispatchOrientation('deviceorientation', {
        webkitCompassHeading: 90,
        webkitCompassAccuracy: 90,
      }),
    );
    expect(result.current.heading).toBeNull();
  });

  it('keeps absolute north alignment corrected to the displayed screen while tilted', () => {
    setScreenAngle(90);
    const { result } = renderHook(() => useNavigationHeading(true));

    act(() =>
      dispatchOrientation('deviceorientationabsolute', {
        absolute: true,
        alpha: 250,
        beta: 90,
        gamma: 20,
      }),
    );

    expect(result.current.heading).toBe(200);
  });

  it('requests absolute compass permission synchronously and starts after it is granted', async () => {
    let resolvePermission!: (value: 'granted') => void;
    const permission = new Promise<'granted'>((resolve) => {
      resolvePermission = resolve;
    });
    const requestPermission = vi.fn(() => permission);
    setPermissionRequest(requestPermission);
    const { result, rerender } = renderHook(({ active }) => useNavigationHeading(active), {
      initialProps: { active: false },
      wrapper: StrictMode,
    });

    act(() => result.current.enableCompass());
    expect(requestPermission).not.toHaveBeenCalled();

    rerender({ active: true });
    act(() => result.current.enableCompass());
    expect(requestPermission).toHaveBeenCalledExactlyOnceWith(true);

    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 40 }));
    expect(result.current.heading).toBeNull();

    await act(async () => {
      resolvePermission('granted');
      await permission;
    });
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 40 }));
    expect(result.current.heading).toBe(320);
  });

  it('quietly falls back after denied permission', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    setPermissionRequest(requestPermission);
    const { result } = renderHook(() => useNavigationHeading(true));

    act(() => result.current.enableCompass());
    await act(async () => Promise.resolve());
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 40 }));

    expect(result.current.heading).toBeNull();
    act(() => result.current.enableCompass());
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it('listens only while active and visible, then reacquires on return', () => {
    const { result, rerender } = renderHook(({ active }) => useNavigationHeading(active), {
      initialProps: { active: false },
    });
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 5 }));
    expect(result.current.heading).toBeNull();

    rerender({ active: true });
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 10 }));
    expect(result.current.heading).toBe(350);

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.heading).toBeNull();
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 20 }));
    expect(result.current.heading).toBeNull();

    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 20 }));
    expect(result.current.heading).toBe(340);

    rerender({ active: false });
    expect(result.current.heading).toBeNull();
    act(() => dispatchOrientation('deviceorientationabsolute', { absolute: true, alpha: 30 }));
    expect(result.current.heading).toBeNull();
  });
});
