import type { Application } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { guardRequests } from './guardRequests';
import { mountEdgeRoutes } from './mountEdgeRoutes';
import { isOriginAllowed, type OriginPolicy } from './origins';
import { IDLE_CONNECTION_TIMEOUT_MS, MAX_REQUEST_BODY_BYTES } from './tuning';

export interface EdgeOptions {
  /** Which browser origins may reach the world room. */
  readonly originPolicy: OriginPolicy;
  /** The client build to serve, or undefined to serve none. */
  readonly clientDirectory: string | undefined;
  /** What `/healthz` reports, or undefined while there is nothing to report yet. */
  readonly health: () => Readonly<Record<string, unknown>> | undefined;
  /** How long a connection may sit with no byte moving before it is closed; `IDLE_CONNECTION_TIMEOUT_MS` unless a test passes a shorter one. */
  readonly idleConnectionTimeoutMs?: number;
}

/**
 * Everything between the port and the world room: the HTTP server itself and
 * the pieces that decide what reaches the room. The edge knows nothing about
 * rooms or Colyseus. Each piece is shaped for the hook Colyseus offers for it,
 * and whoever starts the room plugs them in:
 *
 * - `httpServer` goes to the transport, so the edge owns the server;
 * - `mountRoutes` is Colyseus's `express` option;
 * - `upgradeRefusal` answers Colyseus's `beforeUpgrade` hook;
 * - `matchmakingHeaders` replaces the matchmaker's `getCorsHeaders`;
 * - `guardRequests` is called once Colyseus has bound its routes.
 */
export interface Edge {
  /** The HTTP server, created here and not listening yet. */
  readonly httpServer: HttpServer;
  /** Mounts the security headers, `/healthz` and the client files on an Express app. */
  readonly mountRoutes: (app: Application) => void;
  /** The response that refuses a WebSocket upgrade carrying these request headers, or undefined when it may go on. */
  readonly upgradeRefusal: (headers: Headers) => Response | undefined;
  /** The headers Colyseus adds to every answer it writes itself, for a request carrying these headers: `nosniff`, and the CORS header naming the caller's origin when the policy allows it. */
  readonly matchmakingHeaders: (headers: Headers) => Record<string, string>;
  /** Puts the request guard in front of the routes. Call it once, right after Colyseus has bound them. */
  readonly guardRequests: () => void;
}

export function createEdge({ originPolicy, clientDirectory, health, idleConnectionTimeoutMs = IDLE_CONNECTION_TIMEOUT_MS }: EdgeOptions): Edge {
  const httpServer = createServer();
  httpServer.setTimeout(idleConnectionTimeoutMs);
  return {
    httpServer,
    mountRoutes: (app) => mountEdgeRoutes(app, { clientDirectory, health }),
    upgradeRefusal: (headers) => (isOriginAllowed(headers.get('origin') ?? undefined, originPolicy) ? undefined : new Response(null, { status: 403 })),
    matchmakingHeaders: (headers): Record<string, string> => {
      const origin = headers.get('origin');
      // `Vary` either way: a cache must not hand one origin's answer to another.
      const always = { 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
      // An allowed origin is spelled exactly as a browser sends it (see `isOriginAllowed`), so it is safe to send back as it came.
      if (origin === null || !isOriginAllowed(origin, originPolicy)) return always;
      return { ...always, 'Access-Control-Allow-Origin': origin };
    },
    guardRequests: () => guardRequests(httpServer, { originPolicy, maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES }),
  };
}
