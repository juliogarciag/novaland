import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Application } from 'express';
import type { Server as HttpServer } from 'node:http';
import { MAX_FRAME_BYTES, WORLD_ROOM_NAME } from './tuning';
import { WorldRoom, type WorldRoomOptions } from './WorldRoom';

export interface WorldServerOptions {
  /** TCP port to listen on; 0 picks a free one. Fails if it is busy. */
  readonly port: number;
  /** Seed of the one sim. */
  readonly seed: number;
  /** What stands between the port and the world. The server always passes one; without it the room listens on a bare port, which only the room's own tests do. */
  readonly front?: WorldFront;
}

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
  readonly mountRoutes: (app: Application) => void;
  /** The response that refuses a WebSocket upgrade carrying these request headers, or undefined when it may go on. Colyseus's `beforeUpgrade` hook. */
  readonly upgradeRefusal: (headers: Headers) => Response | undefined;
  /** The CORS headers for a matchmaking request carrying these headers. The matchmaker's `getCorsHeaders`. */
  readonly corsHeaders: (headers: Headers) => Record<string, string>;
  /** Called once, right after Colyseus has bound its routes and before any request can arrive. */
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
 * The `front`, when given, is plugged into Colyseus's own hooks: its HTTP
 * server goes to the transport, its upgrade check to `beforeUpgrade`, its
 * routes to the `express` option and its CORS headers to the matchmaker.
 */
export async function startWorldServer({ port, seed, front }: WorldServerOptions): Promise<WorldServer> {
  const gameServer = new Server({
    transport: new WebSocketTransport({
      maxPayload: MAX_FRAME_BYTES,
      ...(front && { server: front.httpServer, beforeUpgrade: (_request, context) => front.upgradeRefusal(context.headers) }),
    }),
    ...(front && { express: front.mountRoutes }),
    greet: false,
    gracefullyShutdown: false,
  });
  gameServer.define(WORLD_ROOM_NAME, WorldRoom);
  matchMaker.controller.exposedMethods = ['joinById'];
  if (front) {
    // Colyseus answers every origin with `Access-Control-Allow-Origin: *` unless told otherwise: only the front says who may read a matchmaking answer.
    matchMaker.controller.DEFAULT_CORS_HEADERS = withoutAllowOrigin(matchMaker.controller.DEFAULT_CORS_HEADERS);
    matchMaker.controller.getCorsHeaders = front.corsHeaders;
  }
  await gameServer.listen(port);
  // Nothing may be awaited between `listen` and the guard: Colyseus binds its routes as the port opens, and the first request must already find the guard.
  front?.guardRequests();
  const httpServer = gameServer.transport.server;
  if (!httpServer) throw new Error('the transport has no HTTP server to listen on');
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
}

// ---- Helpers ----

function withoutAllowOrigin<CorsHeaders extends Record<string, string>>(headers: CorsHeaders): CorsHeaders {
  const kept: Record<string, string> = { ...headers };
  delete kept['Access-Control-Allow-Origin'];
  return kept as CorsHeaders;
}
