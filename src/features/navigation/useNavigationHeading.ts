import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type CompassPermission = 'unneeded' | 'prompt' | 'granted' | 'denied';

interface DeviceOrientationPermissionConstructor {
  requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'>;
}

interface CompassOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export interface NavigationHeadingState {
  heading: number | null;
  enableCompass: () => void;
}

interface HeadingSample {
  heading: number | null;
  generation: object;
}

const MAX_COMPASS_ACCURACY_DEGREES = 45;

function orientationConstructor(): DeviceOrientationPermissionConstructor | null {
  const constructor = (
    globalThis as typeof globalThis & {
      DeviceOrientationEvent?: DeviceOrientationPermissionConstructor;
    }
  ).DeviceOrientationEvent;
  return constructor ?? null;
}

function normalizeHeading(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return Math.round(normalized) % 360;
}

function screenAngle(): number {
  const currentAngle = screen.orientation?.angle;
  if (Number.isFinite(currentAngle)) return currentAngle;
  const legacyAngle = (window as Window & { orientation?: number }).orientation;
  return Number.isFinite(legacyAngle) ? (legacyAngle ?? 0) : 0;
}

function absoluteFacingHeading(event: DeviceOrientationEvent): number | null {
  if (!event.absolute || !Number.isFinite(event.alpha)) return null;
  return normalizeHeading(360 - (event.alpha as number) + screenAngle());
}

function eventHeading(event: CompassOrientationEvent): number | null | undefined {
  if ('webkitCompassHeading' in event) {
    const heading = event.webkitCompassHeading;
    const accuracy = event.webkitCompassAccuracy;
    if (
      !Number.isFinite(heading) ||
      (heading as number) < 0 ||
      (accuracy !== undefined &&
        (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_COMPASS_ACCURACY_DEGREES))
    ) {
      return null;
    }
    return normalizeHeading((heading as number) + screenAngle());
  }

  if (!event.absolute) return undefined;
  return absoluteFacingHeading(event);
}

export function useNavigationHeading(active: boolean): NavigationHeadingState {
  const constructor = orientationConstructor();
  const requiresPermission = typeof constructor?.requestPermission === 'function';
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [permission, setPermission] = useState<CompassPermission>(() =>
    requiresPermission ? 'prompt' : 'unneeded',
  );
  const [headingSample, setHeadingSample] = useState<HeadingSample | null>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const permissionRef = useRef(permission);
  const listenerGeneration = useMemo(
    () => ({ active, constructor, permission, visible }),
    [active, constructor, permission, visible],
  );

  useLayoutEffect(() => {
    activeRef.current = active;
    permissionRef.current = permission;
  }, [active, permission]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    const canListen = permission === 'unneeded' || permission === 'granted';
    if (!active || !visible || !constructor || !canListen) return;

    const handleOrientation = (rawEvent: Event) => {
      if (!activeRef.current || document.visibilityState !== 'visible') return;
      const nextHeading = eventHeading(rawEvent as CompassOrientationEvent);
      if (nextHeading !== undefined) {
        setHeadingSample((current) =>
          current?.generation === listenerGeneration && current.heading === nextHeading
            ? current
            : { heading: nextHeading, generation: listenerGeneration },
        );
      }
    };
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('deviceorientationabsolute', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
    };
  }, [active, constructor, listenerGeneration, permission, visible]);

  const enableCompass = useCallback(() => {
    if (
      !activeRef.current ||
      permissionRef.current === 'granted' ||
      permissionRef.current === 'denied'
    ) {
      return;
    }
    const currentConstructor = orientationConstructor();
    const requestPermission = currentConstructor?.requestPermission;
    if (!requestPermission) return;

    let request: Promise<'granted' | 'denied'>;
    try {
      request = requestPermission.call(currentConstructor, true);
    } catch {
      if (mountedRef.current) setPermission('denied');
      return;
    }
    void request
      .then((result) => {
        if (mountedRef.current) setPermission(result === 'granted' ? 'granted' : 'denied');
      })
      .catch(() => {
        if (mountedRef.current) setPermission('denied');
      });
  }, []);

  const canExposeHeading =
    active &&
    visible &&
    constructor !== null &&
    (permission === 'unneeded' || permission === 'granted') &&
    headingSample?.generation === listenerGeneration;
  return { heading: canExposeHeading ? headingSample.heading : null, enableCompass };
}
