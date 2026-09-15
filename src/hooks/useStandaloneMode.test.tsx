import { act, renderHook } from '@testing-library/react';
import { useStandaloneMode } from './useStandaloneMode';

const originalStandalone = Object.getOwnPropertyDescriptor(navigator, 'standalone');

function setIosStandalone(value: boolean): void {
  Object.defineProperty(navigator, 'standalone', { configurable: true, value });
}

function mockDisplayMode(matches: boolean) {
  const events = new EventTarget();
  const displayMode = {
    matches,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => displayMode),
  );
  return {
    displayMode,
    change: (nextMatches: boolean) => {
      displayMode.matches = nextMatches;
      events.dispatchEvent(new Event('change'));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalStandalone) {
    Object.defineProperty(navigator, 'standalone', originalStandalone);
  } else {
    Reflect.deleteProperty(navigator, 'standalone');
  }
});

describe('useStandaloneMode', () => {
  it('keeps install help available in a normal browser without matchMedia support', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useStandaloneMode());

    expect(result.current).toBe(false);
  });

  it('detects an installed app through its standalone display mode', () => {
    mockDisplayMode(true);
    const { result } = renderHook(() => useStandaloneMode());

    expect(result.current).toBe(true);
  });

  it('detects an iOS home-screen app even without matchMedia support', () => {
    vi.stubGlobal('matchMedia', undefined);
    setIosStandalone(true);
    const { result } = renderHook(() => useStandaloneMode());

    expect(result.current).toBe(true);
  });

  it('updates when entering and leaving standalone mode and removes its listener on unmount', () => {
    const { displayMode, change } = mockDisplayMode(false);
    const { result, unmount } = renderHook(() => useStandaloneMode());

    expect(result.current).toBe(false);
    void act(() => change(true));
    expect(result.current).toBe(true);
    void act(() => change(false));
    expect(result.current).toBe(false);

    unmount();
    expect(displayMode.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('rechecks the runtime mode after installation instead of assuming a browser tab became an app', () => {
    mockDisplayMode(false);
    const { result } = renderHook(() => useStandaloneMode());

    void act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(result.current).toBe(false);

    setIosStandalone(true);
    void act(() => window.dispatchEvent(new Event('pageshow')));
    expect(result.current).toBe(true);
  });
});
