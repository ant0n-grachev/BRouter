import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createRouteHandler } from './src/server/routeHandler.ts';

const ROUTE_PATH = '/.netlify/functions/route';
const MAX_ROUTE_BODY_BYTES = 4_096;

class RequestBodyTooLarge extends Error {}

async function readBoundedBody(request: IncomingMessage): Promise<string | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunkValue of request) {
    const chunk: unknown = chunkValue;
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      throw new Error('Invalid request body');
    }
    const buffer: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    byteLength += buffer.byteLength;
    if (byteLength > MAX_ROUTE_BODY_BYTES) {
      request.resume();
      throw new RequestBodyTooLarge();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function sendResponse(response: Response, outgoing: ServerResponse): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  return response.arrayBuffer().then((body) => {
    outgoing.end(Buffer.from(body));
  });
}

function routingMiddlewarePlugin(apiKey: string | undefined): Plugin {
  const handler = createRouteHandler({ apiKey });
  const install = (middlewares: {
    use: (
      route: string,
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
        next: (error?: unknown) => void,
      ) => void,
    ) => void;
  }) => {
    middlewares.use(ROUTE_PATH, (request, response) => {
      const controller = new AbortController();
      const abortRequest = () => controller.abort(new DOMException('Canceled', 'AbortError'));
      const abortClosedResponse = () => {
        if (!response.writableEnded) abortRequest();
      };
      request.once('aborted', abortRequest);
      response.once('close', abortClosedResponse);

      void (async () => {
        try {
          const body = await readBoundedBody(request);
          const webRequest = new Request(`http://localhost${ROUTE_PATH}`, {
            method: request.method,
            headers: requestHeaders(request),
            body,
            signal: controller.signal,
          });
          const handlerResponse = await handler(webRequest);
          if (!response.destroyed) await sendResponse(handlerResponse, response);
        } catch (error) {
          if (response.destroyed) return;
          const status = error instanceof RequestBodyTooLarge ? 413 : 400;
          await sendResponse(
            new Response(JSON.stringify({ error: 'Invalid routing request.' }), {
              status,
              headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
              },
            }),
            response,
          );
        } finally {
          request.removeListener('aborted', abortRequest);
          response.removeListener('close', abortClosedResponse);
        }
      })();
    });
  };

  return {
    name: 'local-routing-function',
    apply: 'serve',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix is deliberate: this server configuration reads the secret
  // without creating a VITE_ variable that would be bundled into browser code.
  const serverEnvironment = loadEnv(mode, process.cwd(), '');
  const routingApiKey =
    process.env.OPENROUTESERVICE_API_KEY ?? serverEnvironment.OPENROUTESERVICE_API_KEY;

  return {
    // Netlify owns the explicit SPA navigation fallback. Keeping Vite's preview
    // server in MPA mode prevents missing scripts, styles, and images from being
    // rewritten to index.html during local production verification.
    appType: 'mpa',
    plugins: [
      react(),
      routingMiddlewarePlugin(routingApiKey),
      VitePWA({
        injectRegister: false,
        manifest: false,
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'icons/*.png', 'manifest.json'],
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/\/assets\//, /\/icons\//, /\.[^/?]+(?:\?.*)?$/],
          runtimeCaching: [],
        },
      }),
    ],
    build: {
      target: 'es2020',
    },
  };
});
