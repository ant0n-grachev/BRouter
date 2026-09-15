import { act, renderHook, waitFor } from '@testing-library/react';
import type { StationSnapshot, SystemAvailability } from '../types';
import { getSystemAvailability, loadStationSnapshot } from '../lib/gbfs';
import { useServiceAreaData } from './useServiceAreaData';

vi.mock('../lib/gbfs', () => ({
  loadStationSnapshot: vi.fn(),
  getSystemAvailability: vi.fn((snapshot: StationSnapshot | null): SystemAvailability =>
    snapshot?.isStale ? 'stale' : snapshot ? 'operational' : 'unavailable',
  ),
}));

const mockedLoadStationSnapshot = vi.mocked(loadStationSnapshot);
const mockedGetSystemAvailability = vi.mocked(getSystemAvailability);

function snapshot(overrides: Partial<StationSnapshot> = {}): StationSnapshot {
  return {
    stations: [
      {
        station_id: 'a',
        name: 'Station A',
        lat: 43.0731,
        lon: -89.4012,
        is_installed: true,
        is_renting: true,
        is_returning: true,
        num_bikes_available: 3,
        num_docks_available: 4,
      },
    ],
    fetchedAt: 1_700_000_000_000,
    feedUpdatedAt: 1_700_000_000_000,
    ttlSeconds: 60,
    isStale: false,
    ...overrides,
  };
}

describe('useServiceAreaData', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mockedLoadStationSnapshot.mockReset();
    mockedGetSystemAvailability.mockClear();
  });

  it('bypasses the snapshot cache on a visible interval after a delayed initial fetch', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const first = snapshot();
    const changed = snapshot({ stations: [{ ...first.stations[0], num_bikes_available: 0 }] });
    let resolveInitial!: (value: StationSnapshot) => void;
    const initialRequest = new Promise<StationSnapshot>((resolve) => {
      resolveInitial = resolve;
    });
    let calls = 0;
    mockedLoadStationSnapshot.mockImplementation((options = {}) => {
      calls += 1;
      if (calls === 1) return initialRequest;
      return Promise.resolve(options.forceRefresh ? changed : first);
    });

    const { result } = renderHook(() => useServiceAreaData(15_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      resolveInitial(first);
      await initialRequest;
    });
    expect(result.current.data?.stations[0].num_bikes_available).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(result.current.data?.stations[0].num_bikes_available).toBe(0);
    expect(mockedLoadStationSnapshot).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });

  it('updates availability at the navigation interval and refreshes after returning to the app', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const first = snapshot();
    const changed = snapshot({ stations: [{ ...first.stations[0], num_bikes_available: 0 }] });
    mockedLoadStationSnapshot.mockResolvedValueOnce(first).mockResolvedValue(changed);
    const { result, unmount } = renderHook(() => useServiceAreaData(15_000));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data?.stations[0].num_bikes_available).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.data?.stations[0].num_bikes_available).toBe(0);
    mockedLoadStationSnapshot.mockResolvedValue(first);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.data?.stations[0].num_bikes_available).toBe(0);
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(result.current.data?.stations[0].num_bikes_available).toBe(3);
    unmount();
    vi.useRealTimers();
  });

  it('keeps the last valid snapshot and availability visible when a forced refresh fails', async () => {
    const first = snapshot();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedLoadStationSnapshot
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('network unavailable'));

    const { result } = renderHook(() => useServiceAreaData());
    await waitFor(() => expect(result.current.data?.snapshot).toEqual(first));
    expect(result.current.availability).toBe('operational');

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    expect(result.current.data?.snapshot).toEqual(first);
    expect(result.current.availability).toBe('operational');
    expect(result.current.error).toBe('Unable to load station data right now. Please try again.');
    expect(mockedLoadStationSnapshot).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(diagnostic).toHaveBeenCalledWith('Station data refresh failed.', expect.any(Error));
  });

  it('surfaces metadata-derived stale availability without treating it as a failed request', async () => {
    mockedLoadStationSnapshot.mockResolvedValueOnce(snapshot({ isStale: true }));

    const { result } = renderHook(() => useServiceAreaData());
    await waitFor(() => expect(result.current.availability).toBe('stale'));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.stations).toHaveLength(1);
  });
});
