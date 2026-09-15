import { act, renderHook } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

describe('useOnlineStatus', () => {
  it('tracks browser online and offline events', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    void act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    void act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
