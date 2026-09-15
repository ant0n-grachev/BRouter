import { useEffect, useState } from 'react';

interface ScreenWakeLockSentinel {
  release: () => Promise<void>;
}

interface ScreenWakeLock {
  request: (type: 'screen') => Promise<ScreenWakeLockSentinel>;
}

function releaseQuietly(sentinel: ScreenWakeLockSentinel): void {
  void sentinel.release().catch(() => undefined);
}

export function useScreenAwake(active: boolean): void {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const handleVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!active || !visible) return;

    const wakeLock = (navigator as Navigator & { wakeLock?: ScreenWakeLock }).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;
    let sentinel: ScreenWakeLockSentinel | null = null;

    void wakeLock
      .request('screen')
      .then((acquired) => {
        if (cancelled) {
          releaseQuietly(acquired);
          return;
        }
        sentinel = acquired;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (sentinel) releaseQuietly(sentinel);
    };
  }, [active, visible]);
}
