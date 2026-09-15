import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoute } from './routingClient';

const request = {
  from: { lat: 43.0731, lon: -89.4012 },
  to: { lat: 43.0766, lon: -89.3842 },
  mode: 'bicycling' as const,
};

const routedPath = {
  geometry: [
    { lat: 43.0731, lon: -89.4012 },
    { lat: 43.0766, lon: -89.3842 },
  ],
  instructions: [
    { text: 'Bike east', distanceMeters: 1_500, durationSeconds: 300, geometryIndex: 0 },
  ],
  distanceMeters: 1_500,
  durationSeconds: 300,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchRoute', () => {
  it('posts the routing request and returns a validated routed path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(routedPath), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchRoute(request, controller.signal)).resolves.toEqual(routedPath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/.netlify/functions/route');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects malformed route data instead of drawing an invalid path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...routedPath, geometry: [[-89.4012, 43.0731]] }), {
          status: 200,
        }),
      ),
    );

    await expect(fetchRoute(request)).rejects.toThrow('Routing returned an invalid route.');
  });

  it('surfaces a sanitized server error without exposing response internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: 'Routing is temporarily unavailable.', detail: 'secret-key' }),
            { status: 502 },
          ),
        ),
    );

    await expect(fetchRoute(request)).rejects.toThrow('Routing is temporarily unavailable.');
  });

  it('passes cancellation through to the request promptly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
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
      }),
    );
    const controller = new AbortController();
    const pending = fetchRoute(request, controller.signal);

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops a stalled browser request after 20 seconds with a friendly error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          );
        });
      }),
    );

    const assertion = expect(fetchRoute(request)).rejects.toThrow(
      'Routing request timed out. Please try again.',
    );
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });
});
