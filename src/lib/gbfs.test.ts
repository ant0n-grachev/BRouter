import {
  DEFAULT_STATION_INFORMATION_URL,
  DEFAULT_STATION_STATUS_URL,
  getSystemAvailability,
  loadStationSnapshot,
  resetStationSnapshotCache,
  type StationFetch,
} from './gbfs';

const infoUrl = 'https://example.test/info.json';
const statusUrl = 'https://example.test/status.json';

function response(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
}

function resolvedResponse(body: unknown, ok = true): Promise<Response> {
  return Promise.resolve(response(body, ok));
}

function discovery() {
  return {
    last_updated: 1_700_000_000,
    ttl: 60,
    data: {
      en: {
        feeds: [
          { name: 'station_information', url: infoUrl },
          { name: 'station_status', url: statusUrl },
        ],
      },
    },
  };
}

function info(stations: unknown[]) {
  return { last_updated: 1_700_000_000, ttl: 60, data: { stations } };
}

function status(stations: unknown[]) {
  return { last_updated: 1_700_000_000, ttl: 60, data: { stations } };
}

function stationInfo(station_id: string, lat = 43.0731, lon = -89.4012) {
  return { station_id, name: `Station ${station_id}`, lat, lon };
}

function stationStatus(station_id: string, bikes = 3, docks = 4) {
  return {
    station_id,
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    num_bikes_available: bikes,
    num_docks_available: docks,
  };
}

describe('loadStationSnapshot', () => {
  beforeEach(() => {
    resetStationSnapshotCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves discovery, fetches information and status in parallel, and normalizes a snapshot', async () => {
    const requests: string[] = [];
    let releaseFeeds: (() => void) | undefined;
    const feedGate = new Promise<void>((resolve) => {
      releaseFeeds = resolve;
    });
    const fetcher: StationFetch = vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith('gbfs.json')) return response(discovery());
      await feedGate;
      return url === infoUrl
        ? response(info([stationInfo('a')]))
        : response(status([stationStatus('a', -2, -3)]));
    });

    const loading = loadStationSnapshot({ fetcher, now: () => 1_700_000_030_000 });
    await Promise.resolve();
    expect(requests).toEqual(['https://gbfs.bcycle.com/bcycle_madison/gbfs.json']);

    await vi.waitFor(() => {
      expect(requests).toEqual([
        'https://gbfs.bcycle.com/bcycle_madison/gbfs.json',
        infoUrl,
        statusUrl,
      ]);
    });
    releaseFeeds?.();

    await expect(loading).resolves.toMatchObject({
      fetchedAt: 1_700_000_030_000,
      feedUpdatedAt: 1_700_000_000_000,
      ttlSeconds: 60,
      isStale: false,
      stations: [
        expect.objectContaining({
          station_id: 'a',
          num_bikes_available: 0,
          num_docks_available: 0,
        }),
      ],
    });
  });

  it('ignores malformed individual records but rejects an unusable feed', async () => {
    const fetcher: StationFetch = vi.fn((url: string) => {
      if (url.endsWith('gbfs.json')) return resolvedResponse(discovery());
      return url === infoUrl
        ? resolvedResponse(
            info([stationInfo('valid'), stationInfo('bad-location', 99, 0), { station_id: '' }]),
          )
        : resolvedResponse(
            status([
              stationStatus('valid'),
              stationStatus('bad-location'),
              { ...stationStatus('missing-flag'), is_renting: 2 },
            ]),
          );
    });

    await expect(loadStationSnapshot({ fetcher })).resolves.toMatchObject({
      stations: [expect.objectContaining({ station_id: 'valid' })],
    });

    resetStationSnapshotCache();
    const invalidFetcher: StationFetch = vi.fn((url: string) => {
      if (url.endsWith('gbfs.json')) return resolvedResponse(discovery());
      return url === infoUrl
        ? resolvedResponse(info([stationInfo('bad', 91, 0)]))
        : resolvedResponse(status([stationStatus('bad')]));
    });
    await expect(loadStationSnapshot({ fetcher: invalidFetcher })).rejects.toThrow(
      'usable station records',
    );
  });

  it('falls back to documented station URLs when discovery is unavailable', async () => {
    const fetcher: StationFetch = vi.fn((url: string) => {
      if (url.endsWith('gbfs.json')) return resolvedResponse({}, false);
      return url === DEFAULT_STATION_INFORMATION_URL
        ? resolvedResponse(info([stationInfo('fallback')]))
        : resolvedResponse(status([stationStatus('fallback')]));
    });

    await expect(loadStationSnapshot({ fetcher })).resolves.toMatchObject({
      stations: [expect.objectContaining({ station_id: 'fallback' })],
    });
    expect(fetcher).toHaveBeenCalledWith(DEFAULT_STATION_STATUS_URL, expect.any(Object));
  });

  it('deduplicates concurrent loads, caches for 15 seconds, and lets force refresh bypass the cache', async () => {
    let calls = 0;
    const fetcher: StationFetch = vi.fn((url: string) => {
      calls += 1;
      if (url.endsWith('gbfs.json')) return resolvedResponse(discovery());
      return url === infoUrl
        ? resolvedResponse(info([stationInfo('a')]))
        : resolvedResponse(status([stationStatus('a')]));
    });
    const now = vi.fn(() => 1_700_000_010_000);

    const [first, second] = await Promise.all([
      loadStationSnapshot({ fetcher, now }),
      loadStationSnapshot({ fetcher, now }),
    ]);
    expect(first).toEqual(second);
    expect(calls).toBe(3);

    await loadStationSnapshot({ fetcher, now });
    expect(calls).toBe(3);

    await loadStationSnapshot({ fetcher, now, forceRefresh: true });
    expect(calls).toBe(6);
  });

  it('marks stale data from feed metadata and keeps missing metadata nullable while using the documented cache fallback', async () => {
    const staleFetcher: StationFetch = vi.fn((url: string) => {
      if (url.endsWith('gbfs.json')) return resolvedResponse(discovery());
      return url === infoUrl
        ? resolvedResponse({ ...info([stationInfo('a')]), last_updated: 1_700_000_000, ttl: 10 })
        : resolvedResponse({
            ...status([stationStatus('a')]),
            last_updated: 1_700_000_000,
            ttl: 10,
          });
    });

    await expect(
      loadStationSnapshot({ fetcher: staleFetcher, now: () => 1_700_000_011_000 }),
    ).resolves.toMatchObject({ isStale: true });

    resetStationSnapshotCache();
    const fallbackFetcher: StationFetch = vi.fn((url: string) => {
      if (url.endsWith('gbfs.json')) return resolvedResponse(discovery());
      return url === infoUrl
        ? resolvedResponse({ ...info([stationInfo('a')]), last_updated: 'invalid', ttl: -1 })
        : resolvedResponse({ ...status([stationStatus('a')]), last_updated: 'invalid', ttl: -1 });
    });
    await expect(
      loadStationSnapshot({ fetcher: fallbackFetcher, now: () => 1_700_000_016_000 }),
    ).resolves.toMatchObject({
      feedUpdatedAt: null,
      ttlSeconds: null,
      isStale: false,
    });
  });
});

describe('getSystemAvailability', () => {
  const snapshot = (
    stations: NonNullable<Parameters<typeof getSystemAvailability>[0]>['stations'],
  ) => ({
    stations,
    fetchedAt: 1,
    feedUpdatedAt: 1,
    ttlSeconds: 15,
    isStale: false,
  });

  it.each([
    ['operational', [stationStatus('a', 1, 1)]],
    ['no-bikes', [stationStatus('a', 0, 1)]],
    ['no-docks', [stationStatus('a', 1, 0)]],
    ['service-disabled', [{ ...stationStatus('a', 1, 1), is_renting: 0, is_returning: 0 }]],
  ] as const)(
    'returns %s for the corresponding normal system state',
    (availability, statusStations) => {
      const stations = statusStations.map((entry) => ({
        ...entry,
        name: 'Station',
        lat: 43.0731,
        lon: -89.4012,
        is_installed: Boolean(entry.is_installed),
        is_renting: Boolean(entry.is_renting),
        is_returning: Boolean(entry.is_returning),
      }));
      expect(getSystemAvailability(snapshot(stations))).toBe(availability);
    },
  );

  it('distinguishes stale and unavailable snapshots', () => {
    expect(getSystemAvailability(null)).toBe('unavailable');
    expect(getSystemAvailability({ ...snapshot([]), isStale: true })).toBe('stale');
  });
});
