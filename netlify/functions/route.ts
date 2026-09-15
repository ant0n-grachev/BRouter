// Netlify's current web-function API uses a default Request -> Response handler:
// https://docs.netlify.com/build/functions/api/
import { handleRouteRequest } from '../../src/server/routeHandler.ts';

export default async function route(request: Request): Promise<Response> {
  return handleRouteRequest(request);
}
