import { describe, expect, it, vi } from 'vitest';
import { createRouteHandler } from './routeHandler';

const VALID_BODY = {
  from: { lat: 43.0731, lon: -89.4012 },
  to: { lat: 43.0766, lon: -89.3842 },
  mode: 'bicycling',
};

function incoming(body: unknown = VALID_BODY, method = 'POST', signal?: AbortSignal): Request {
  return new Request('https://example.test/.netlify/functions/route', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal,
  });
}

function orsResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-89.4012, 43.0731],
              [-89.392, 43.074],
              [-89.3842, 43.0766],
            ],
          },
          properties: {
            summary: { distance: 1_500, duration: 300 },
            segments: [
              {
                steps: [
                  {
                    instruction: 'Bike east',
                    distance: 900,
                    duration: 180,
                    way_points: [0, 1],
                  },
                  {
                    instruction: 'Arrive at the station',
                    distance: 600,
                    duration: 120,
                    way_points: [1, 2],
                  },
                ],
              },
            ],
          },
        },
      ],
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/geo+json' } },
  );
}

describe('createRouteHandler', () => {
  it('returns a friendly no-store response when the server key is absent', async () => {
    const fetchMock = vi.fn();
    const handler = createRouteHandler({ apiKey: '', fetch: fetchMock });

    const response = await handler(incoming());

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'In-app routing is not configured yet.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported method', VALID_BODY, 'GET', 405],
    ['unsupported mode', { ...VALID_BODY, mode: 'driving' }, 'POST', 400],
    [
      'non-finite coordinate',
      { ...VALID_BODY, from: { lat: Number.NaN, lon: -89.4012 } },
      'POST',
      400,
    ],
    [
      'point outside the Madison region',
      { ...VALID_BODY, to: { lat: 44.0, lon: -89.3842 } },
      'POST',
      400,
    ],
  ])('rejects an %s before calling ORS', async (_case, body, method, status) => {
    const fetchMock = vi.fn();
    const handler = createRouteHandler({ apiKey: 'server-secret', fetch: fetchMock });

    const response = await handler(incoming(body, method));

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['walking', 'foot-walking'],
    ['bicycling', 'cycling-regular'],
  ])('maps %s to the fixed ORS %s profile and normalizes GeoJSON', async (mode, profile) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(orsResponse()));
    const handler = createRouteHandler({ apiKey: 'server-secret', fetch: fetchMock });

    const response = await handler(incoming({ ...VALID_BODY, mode }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`);
    expect(init.headers).toEqual({
      authorization: 'server-secret',
      'content-type': 'application/json',
    });
    if (typeof init.body !== 'string') throw new Error('Expected a JSON request body');
    const sentBody: unknown = JSON.parse(init.body);
    expect(sentBody).toEqual({
      coordinates: [
        [-89.4012, 43.0731],
        [-89.3842, 43.0766],
      ],
      instructions: true,
    });
    const payload: unknown = await response.json();
    expect(payload).toEqual({
      geometry: [
        { lat: 43.0731, lon: -89.4012 },
        { lat: 43.074, lon: -89.392 },
        { lat: 43.0766, lon: -89.3842 },
      ],
      instructions: [
        { text: 'Bike east', distanceMeters: 900, durationSeconds: 180, geometryIndex: 0 },
        {
          text: 'Arrive at the station',
          distanceMeters: 600,
          durationSeconds: 120,
          geometryIndex: 1,
        },
      ],
      distanceMeters: 1_500,
      durationSeconds: 300,
    });
    expect(JSON.stringify(payload)).not.toContain('server-secret');
  });

  it('caches matching routes and spaces different outbound requests by 1500ms', async () => {
    let now = 10_000;
    const sleeps: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(orsResponse()));
    const handler = createRouteHandler({
      apiKey: 'server-secret',
      fetch: fetchMock,
      now: () => now,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });

    expect((await handler(incoming())).status).toBe(200);
    expect((await handler(incoming())).status).toBe(200);
    expect(
      (await handler(incoming({ ...VALID_BODY, to: { lat: 43.077, lon: -89.3835 } }))).status,
    ).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_500]);
  });

  it.each([
    [
      'rate limit',
      new Response('upstream account detail', { status: 429 }),
      429,
      'Routing is busy. Please try again shortly.',
    ],
    [
      'provider failure',
      new Response('upstream secret detail', { status: 500 }),
      502,
      'Routing is temporarily unavailable.',
    ],
    [
      'missing route',
      new Response('upstream location detail', { status: 422 }),
      422,
      'No route found for those locations.',
    ],
    ['malformed route', orsResponse({ features: [] }), 502, 'Routing is temporarily unavailable.'],
  ])('sanitizes a %s response', async (_case, upstream, status, message) => {
    const handler = createRouteHandler({
      apiKey: 'server-secret',
      fetch: vi.fn().mockResolvedValue(upstream),
    });

    const response = await handler(incoming());

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it('aborts a stalled ORS request after the timeout', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new DOMException('Canceled', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const handler = createRouteHandler({
      apiKey: 'server-secret',
      fetch: fetchMock,
      timeoutMs: 5,
    });

    const response = await handler(incoming());

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error: 'Routing timed out. Please try again.',
    });
  });

  it('does not start an ORS request when the incoming request was already canceled', async () => {
    const fetchMock = vi.fn();
    const handler = createRouteHandler({ apiKey: 'server-secret', fetch: fetchMock });
    const controller = new AbortController();
    const request = incoming(VALID_BODY, 'POST', controller.signal);
    controller.abort(new DOMException('Canceled', 'AbortError'));

    const response = await handler(request);

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toEqual({
      error: 'Routing request was canceled.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
