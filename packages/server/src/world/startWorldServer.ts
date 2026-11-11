import { matchMaker, Server, type ServerOptions } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Server as HttpServer } from 'node:http';
import { MAX_FRAME_BYTES, WORLD_ROOM_NAME } from './tuning';
import { WorldRoom, type WorldRoomOptions } from './WorldRoom';

export interface WorldServerOptions {
  /** TCP port to listen on; 0 picks a free one. Fails if it is busy. */
  readonly port: number;
  /** Seed of the one sim. */
  readonly seed: number;
  /** What stands between the port and the world. */
  readonly front: WorldFront;
}

/** The app Colyseus hands to its `express` option, named through Colyseus so the world imports no HTTP library. */
export type RoutesApp = Parameters<NonNullable<ServerOptions['express']>>[0];

/**
 * What stands between the port and the world: the HTTP server and what decides
 * which requests reach the room. The HTTP edge builds it; it is typed here so
 * the world depends on nothing of the edge. The world hands each piece to the
 * hook Colyseus offers for it and never looks inside.
 */
export interface WorldFront {
  /** The HTTP server to listen on. */
  readonly httpServer: HttpServer;
  /** Mounts the HTTP routes that are not Colyseus's own. Colyseus's `express` option. */
  readonly mountRoutes: (app: RoutesApp) => void;
  /** The headers Colyseus adds to every answer it writes itself, for a request carrying these headers. The matchmaker's `getCorsHeaders`. */
  readonly matchmakingHeaders: (headers: Headers) => Record<string, string>;
  /** Called once, right after Colyseus has bound its routes and its upgrade handler and before any request can arrive. */
  readonly guardRequests: () => void;
}

/** A running world server: one Colyseus server with the one world room created. */
export interface WorldServer {
  /** The port actually bound (matters when 0 was asked for). */
  readonly port: number;
  readonly roomId: string;
  /** The room instance, for smoke runs and tests in the same process. */
  readonly room: WorldRoom;
  /** Disconnects every client, disposes the room (which destroys the sim) and closes the port. */
  stop(): Promise<void>;
}

/**
 * Boots the world: a Colyseus server on `port` whose matchmaker only answers
 * `joinById`, so a client can neither create a second world nor join one by
 * name, and the one `WorldRoom`, created here and never by a client. Listens
 * first so the room is reachable the moment it exists. `@colyseus/core` and
 * the transport are imported directly: the `colyseus` meta-package would
 * also load `@colyseus/tools`, which reads `.env` files into the environment.
 *
 * The `front` is plugged into Colyseus's own hooks: its HTTP server goes to
 * the transport, its routes to the `express` option and its headers to the
 * matchmaker.
 */
export function startWorldServer(options: WorldServerOptions): Promise<WorldServer> {
  return bootWorldServer(options);
}

/** `startWorldServer` on a bare port, with nothing in front of the room: for the room's own tests, never for a server anyone can reach. */
function startBareWorldServer(options: Omit<WorldServerOptions, 'front'>): Promise<WorldServer> {
  return bootWorldServer(options);
}

// ---- Helpers ----

/** What Colyseus's matchmaker answers with when nothing replaces it, kept so a bare boot gets it back after a fronted one in the same process. */
const COLYSEUS_CORS = { defaultHeaders: matchMaker.controller.DEFAULT_CORS_HEADERS, headersFor: matchMaker.controller.getCorsHeaders };

async function bootWorldServer({ port, seed, front }: Omit<WorldServerOptions, 'front'> & { readonly front?: WorldFront }): Promise<WorldServer> {
  const transport = new WebSocketTransport({
    maxPayload: MAX_FRAME_BYTES,
    ...(front && { server: front.httpServer }),
  });
  const httpServer = transport.server;
  if (!httpServer) throw new Error('the transport has no HTTP server to listen on');
  const gameServer = new Server({
    transport,
    ...(front && { express: front.mountRoutes }),
    greet: false,
    gracefullyShutdown: false,
  });
  gameServer.define(WORLD_ROOM_NAME, WorldRoom);
  matchMaker.controller.exposedMethods = ['joinById'];
  // Colyseus answers every origin with `Access-Control-Allow-Origin: *` unless told otherwise: only the front says who may read a matchmaking answer.
  matchMaker.controller.DEFAULT_CORS_HEADERS = front ? withoutAllowOrigin(COLYSEUS_CORS.defaultHeaders) : COLYSEUS_CORS.defaultHeaders;
  matchMaker.controller.getCorsHeaders = front ? front.matchmakingHeaders : COLYSEUS_CORS.headersFor;
  try {
    await portOpened({ gameServer, httpServer, port });
    // Nothing may be awaited between the port opening and the guard: Colyseus binds its routes as the port opens, and the first request must already find the guard.
    front?.guardRequests();
    const listing = await matchMaker.createRoom(WORLD_ROOM_NAME, { seed } satisfies WorldRoomOptions);
    const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
    const address = httpServer.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : port;
    return {
      port: boundPort,
      roomId: listing.roomId,
      room,
      stop: () => gameServer.gracefullyShutdown(false),
    };
  } catch (error) {
    // A boot that fails must leave nothing behind: not the port if it was opened, not the matchmaker's timers.
    await gameServer.gracefullyShutdown(false).catch(() => undefined);
    throw error;
  }
}

interface PortToOpen {
  readonly gameServer: Server;
  readonly httpServer: HttpServer;
  readonly port: number;
}

/** Resolves once Colyseus listens on the port. Rejects when the port cannot be opened (it is busy, say): Colyseus only logs that error, and its own promise would wait for ever. */
function portOpened({ gameServer, httpServer, port }: PortToOpen): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    gameServer.listen(port).then(() => {
      httpServer.removeListener('error', reject);
      resolve();
    }, reject);
  });
}

function withoutAllowOrigin<CorsHeaders extends Record<string, string>>(headers: CorsHeaders): CorsHeaders {
  const keptHeaders: Record<string, string> = { ...headers };
  delete keptHeaders['Access-Control-Allow-Origin'];
  return keptHeaders as CorsHeaders;
}

export const __testing__ = { startBareWorldServer };
