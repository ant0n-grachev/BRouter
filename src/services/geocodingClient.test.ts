import { z } from 'zod';
import {
  createGeocodingClient,
  GeocodingClientError,
  parseCoordinateInput,
  type GeocodingSearchOutcome,
  type StorageLike,
} from './geocodingClient';

const DAY_MS = 24 * 60 * 60 * 1000;
const immediateSleep = (): Promise<void> => Promise.resolve();

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function photonResult(name = 'Capitol Square, Madison, Wisconsin'): unknown {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-89.38408, 43.07476] },
        properties: { name },
      },
    ],
  };
}

function expectResults(outcome: GeocodingSearchOutcome): void {
  expect(outcome).toEqual({
    kind: 'results',
    suggestions: [{ lat: 43.07476, lon: -89.38408, label: 'Capitol Square, Madison, Wisconsin' }],
  });
}

describe('geocoding client', () => {
  it('uses Photon for address lookup', async () => {
    const requestedUrls: string[] = [];
    const client = createGeocodingClient({
      storage: null,
      sleep: immediateSleep,
      fetch: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          jsonResponse({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.38408, 43.07476] },
                properties: {
                  name: 'Capitol Square',
                  city: 'Madison',
                  state: 'Wisconsin',
                },
              },
            ],
          }),
        );
      },
    });

    const outcome = await client.search('Capitol Square');

    const request = new URL(requestedUrls[0] ?? '');
    expect(`${request.origin}${request.pathname}`).toBe('https://photon.komoot.io/api');
    expect(request.searchParams.get('q')).toBe('capitol square');
    expect(request.searchParams.get('limit')).toBe('5');
    expect(outcome).toEqual({
      kind: 'results',
      suggestions: [{ lat: 43.07476, lon: -89.38408, label: 'Capitol Square, Madison, Wisconsin' }],
    });
  });

  it('deduplicates Photon features that render the same address label', async () => {
    const client = createGeocodingClient({
      storage: null,
      sleep: immediateSleep,
      fetch: () =>
        Promise.resolve(
          jsonResponse({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.394, 43.074] },
                properties: { name: 'State Street', city: 'Madison', state: 'Wisconsin' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.395, 43.075] },
                properties: { name: 'State Street', city: 'Madison', state: 'Wisconsin' },
              },
            ],
          }),
        ),
    });

    await expect(client.search('State Street')).resolves.toEqual({
      kind: 'results',
      suggestions: [{ lat: 43.074, lon: -89.394, label: 'State Street, Madison, Wisconsin' }],
    });
  });

  it('parses only in-range latitude and longitude coordinate input', () => {
    expect(parseCoordinateInput('43.0731, -89.4012')).toEqual({
      lat: 43.0731,
      lon: -89.4012,
      label: '43.07310, -89.40120',
    });
    expect(parseCoordinateInput('91, 0')).toBeNull();
    expect(parseCoordinateInput(', -89.4012')).toBeNull();
    expect(parseCoordinateInput('Capitol Square')).toBeNull();
  });

  it('returns valid local coordinates without an outbound request', async () => {
    const requestedUrls: string[] = [];
    const client = createGeocodingClient({
      sleep: immediateSleep,
      fetch: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(jsonResponse(photonResult()));
      },
    });

    await expect(client.search(' 43.0731, -89.4012 ')).resolves.toEqual({
      kind: 'results',
      suggestions: [{ lat: 43.0731, lon: -89.4012, label: '43.07310, -89.40120' }],
    });
    expect(requestedUrls).toEqual([]);
  });

  it.each(['91, 0', '-91, 0', '0, 181', '0, -181'])(
    'rejects out-of-range coordinates locally without an outbound request: %s',
    async (query) => {
      const requestedUrls: string[] = [];
      const client = createGeocodingClient({
        sleep: immediateSleep,
        fetch: (input) => {
          requestedUrls.push(String(input));
          return Promise.resolve(jsonResponse([]));
        },
      });

      await expect(client.search(query)).rejects.toMatchObject({ code: 'invalid_coordinates' });
      expect(requestedUrls).toHaveLength(0);
    },
  );

  it('normalizes a query cache key and serves a memory cache hit', async () => {
    let requests = 0;
    const client = createGeocodingClient({
      sleep: immediateSleep,
      fetch: () => {
        requests += 1;
        return Promise.resolve(jsonResponse(photonResult()));
      },
    });

    expectResults(await client.search('  Capitol   Square '));
    expectResults(await client.search('capitol square'));
    expect(requests).toBe(1);
  });

  it('restores a current versioned storage cache entry', async () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;
    storage.setItem(
      'bcycle.geocoding-cache.v2',
      JSON.stringify({
        version: 2,
        entries: [
          {
            key: 'capitol square',
            createdAt: now - DAY_MS,
            suggestions: [
              { lat: 43.07476, lon: -89.38408, label: 'Capitol Square, Madison, Wisconsin' },
            ],
          },
        ],
      }),
    );
    const client = createGeocodingClient({
      storage,
      now: () => now,
      sleep: immediateSleep,
      fetch: () => Promise.reject(new Error('storage cache should prevent a fetch')),
    });

    expectResults(await client.search('CAPITOL   SQUARE'));
  });

  it('drops expired or malformed storage data without failing the search', async () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;
    storage.setItem('bcycle.geocoding-cache.v2', 'not json');
    let requests = 0;
    const malformedClient = createGeocodingClient({
      storage,
      now: () => now,
      sleep: immediateSleep,
      fetch: () => {
        requests += 1;
        return Promise.resolve(jsonResponse(photonResult()));
      },
    });
    expectResults(await malformedClient.search('Capitol Square'));

    storage.setItem(
      'bcycle.geocoding-cache.v2',
      JSON.stringify({
        version: 2,
        entries: [
          {
            key: 'capitol square',
            createdAt: now - 7 * DAY_MS - 1,
            suggestions: [{ lat: 43.07476, lon: -89.38408, label: 'stale' }],
          },
        ],
      }),
    );
    const expiredClient = createGeocodingClient({
      storage,
      now: () => now,
      sleep: immediateSleep,
      fetch: () => {
        requests += 1;
        return Promise.resolve(jsonResponse(photonResult()));
      },
    });
    expectResults(await expiredClient.search('Capitol Square'));
    expect(requests).toBe(2);
  });

  it('keeps persisted cache entries within its maximum size', async () => {
    const storage = new MemoryStorage();
    let now = 1_700_000_000_000;
    const client = createGeocodingClient({
      storage,
      now: () => now++,
      sleep: immediateSleep,
      fetch: (input) =>
        Promise.resolve(
          jsonResponse(photonResult(new URL(String(input)).searchParams.get('q') ?? '')),
        ),
    });

    for (let index = 0; index < 101; index += 1) {
      await client.search(`place ${index}`);
    }

    const persisted = storage.getItem('bcycle.geocoding-cache.v2');
    expect(persisted).not.toBeNull();
    const cacheSchema = z.object({ version: z.literal(2), entries: z.array(z.unknown()).max(100) });
    expect(cacheSchema.safeParse(JSON.parse(persisted ?? '')).success).toBe(true);
  });

  it('spaces outbound requests by at least one second', async () => {
    let now = 1_700_000_000_000;
    const sleepDurations: number[] = [];
    const client = createGeocodingClient({
      now: () => now,
      sleep: (milliseconds) => {
        sleepDurations.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
      fetch: () => Promise.resolve(jsonResponse(photonResult())),
    });

    await client.search('first place');
    await client.search('second place');
    expect(sleepDurations).toEqual([1000]);
  });

  it('returns an empty outcome when Photon has no valid matches', async () => {
    const client = createGeocodingClient({
      sleep: immediateSleep,
      fetch: () =>
        Promise.resolve(
          jsonResponse({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: ['invalid', -89.4] },
                properties: {},
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 91] },
                properties: {},
              },
            ],
          }),
        ),
    });

    await expect(client.search('nowhere')).resolves.toEqual({ kind: 'empty' });
  });

  it('bounds service-area requests and removes results beyond every station radius', async () => {
    const requestedUrls: string[] = [];
    const client = createGeocodingClient({
      sleep: immediateSleep,
      fetch: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          jsonResponse({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.4012, 43.0731] },
                properties: { name: 'Capitol Square', city: 'Madison', state: 'Wisconsin' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.38, 43.09] },
                properties: { name: 'Inside the rectangle but outside station coverage' },
              },
            ],
          }),
        );
      },
    });
    const serviceArea = {
      bounds: { west: -89.43, north: 43.1, east: -89.36, south: 43.05 },
      points: [{ lat: 43.0731, lon: -89.4012 }],
      cacheKey: 'madison-fixture',
    };

    const outcome = await client.search('State Street', { serviceArea });

    const request = new URL(requestedUrls[0] ?? '');
    expect(request.searchParams.get('bbox')).toBe('-89.43,43.05,-89.36,43.1');
    expect(outcome).toEqual({
      kind: 'results',
      suggestions: [{ lat: 43.0731, lon: -89.4012, label: 'Capitol Square, Madison, Wisconsin' }],
    });
  });

  it('keeps an in-area result when an out-of-area feature with the same label comes first', async () => {
    const client = createGeocodingClient({
      storage: null,
      sleep: immediateSleep,
      fetch: () =>
        Promise.resolve(
          jsonResponse({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.38, 43.09] },
                properties: { name: 'State Street', city: 'Madison', state: 'Wisconsin' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-89.4012, 43.0731] },
                properties: { name: 'State Street', city: 'Madison', state: 'Wisconsin' },
              },
            ],
          }),
        ),
    });
    const serviceArea = {
      bounds: { west: -89.43, north: 43.1, east: -89.36, south: 43.05 },
      points: [{ lat: 43.0731, lon: -89.4012 }],
      cacheKey: 'madison-duplicate-fixture',
    };

    await expect(client.search('State Street', { serviceArea })).resolves.toEqual({
      kind: 'results',
      suggestions: [{ lat: 43.0731, lon: -89.4012, label: 'State Street, Madison, Wisconsin' }],
    });
  });

  it('maps offline, rate-limited, network, and aborted failures to typed errors', async () => {
    const offline = createGeocodingClient({ storage: null, online: () => false });
    await expect(offline.search('an uncached location')).rejects.toMatchObject({ code: 'offline' });

    const rateLimited = createGeocodingClient({
      storage: null,
      sleep: immediateSleep,
      fetch: () => Promise.resolve(jsonResponse([], 429)),
    });
    await expect(rateLimited.search('a rate-limited location')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });

    const network = createGeocodingClient({
      storage: null,
      sleep: immediateSleep,
      fetch: () => Promise.reject(new TypeError('failed to fetch')),
    });
    await expect(network.search('a network-failing location')).rejects.toMatchObject({
      code: 'network',
    });

    const controller = new AbortController();
    controller.abort();
    const aborted = createGeocodingClient({
      sleep: immediateSleep,
      fetch: () => Promise.resolve(jsonResponse(photonResult())),
    });
    await expect(aborted.search('Capitol Square', { signal: controller.signal })).rejects.toSatisfy(
      (error: unknown) => error instanceof GeocodingClientError && error.code === 'aborted',
    );
  });
});
