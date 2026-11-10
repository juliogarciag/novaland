import type { Application } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { guardRequests } from './guardRequests';
import { mountEdgeRoutes } from './mountEdgeRoutes';
import { isOriginAllowed, type OriginPolicy } from './origins';

export interface EdgeOptions {
  /** Which browser origins may reach the world room. */
  readonly originPolicy: OriginPolicy;
  /** The client build to serve, or undefined to serve none. */
  readonly clientDirectory: string | undefined;
  /** The largest request body let through to the routes, in bytes. */
  readonly maxRequestBodyBytes: number;
  /** What `/healthz` reports, or undefined while there is nothing to report yet. */
  readonly health: () => Readonly<Record<string, unknown>> | undefined;
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
 * - `corsHeaders` replaces the matchmaker's `getCorsHeaders`;
 * - `guardRequests` is called once Colyseus has bound its routes.
 */
export interface Edge {
  /** The HTTP server, created here and not listening yet. */
  readonly httpServer: HttpServer;
  /** Mounts the security headers, `/healthz` and the client files on an Express app. */
  readonly mountRoutes: (app: Application) => void;
  /** The response that refuses a WebSocket upgrade carrying these request headers, or undefined when it may go on. */
  readonly upgradeRefusal: (headers: Headers) => Response | undefined;
  /** The CORS headers for a matchmaking request carrying these headers: the caller's origin when the policy allows it, none otherwise. */
  readonly corsHeaders: (headers: Headers) => Record<string, string>;
  /** Puts the request guard in front of the routes. Call it once, right after Colyseus has bound them. */
  readonly guardRequests: () => void;
}

export function createEdge({ originPolicy, clientDirectory, maxRequestBodyBytes, health }: EdgeOptions): Edge {
  const httpServer = createServer();
  return {
    httpServer,
    mountRoutes: (app) => mountEdgeRoutes(app, { clientDirectory, health }),
    upgradeRefusal: (headers) => (isOriginAllowed(headers.get('origin') ?? undefined, originPolicy) ? undefined : new Response(null, { status: 403 })),
    corsHeaders: (headers): Record<string, string> => {
      const origin = headers.get('origin');
      // `Vary` either way: a cache must not hand one origin's answer to another.
      if (origin === null || !isOriginAllowed(origin, originPolicy)) return { Vary: 'Origin' };
      return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    },
    guardRequests: () => guardRequests(httpServer, { originPolicy, maxBodyBytes: maxRequestBodyBytes }),
  };
}
