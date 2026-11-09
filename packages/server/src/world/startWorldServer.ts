import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { MAX_FRAME_BYTES, MAX_REQUEST_BODY_BYTES, WORLD_ROOM_NAME } from './tuning';
import { WorldRoom, type WorldRoomOptions } from './WorldRoom';

export interface WorldServerOptions {
  /** TCP port to listen on; 0 picks a free one. Fails if it is busy. */
  readonly port: number;
  /** Seed of the one sim. */
  readonly seed: number;
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
 */
export async function startWorldServer({ port, seed }: WorldServerOptions): Promise<WorldServer> {
  const gameServer = new Server({
    transport: new WebSocketTransport({ maxPayload: MAX_FRAME_BYTES }),
    greet: false,
    gracefullyShutdown: false,
  });
  gameServer.define(WORLD_ROOM_NAME, WorldRoom);
  matchMaker.controller.exposedMethods = ['joinById'];
  await gameServer.listen(port);
  const httpServer = gameServer.transport.server;
  if (!httpServer) throw new Error('the transport has no HTTP server to listen on');
  refuseLargeRequestBodies(httpServer, MAX_REQUEST_BODY_BYTES);
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

/**
 * Colyseus reads the whole body of every matchmaking POST before it looks at
 * the method, with no size limit. This runs before its handler (it is
 * prepended after `listen`, which is when Colyseus binds its routes) and
 * closes the connection of any request that declares or streams more than
 * `maxBytes`, so the body is never buffered. No response is written: Colyseus's
 * handler still runs, finds the socket gone and answers nothing.
 */
function refuseLargeRequestBodies(httpServer: HttpServer, maxBytes: number): void {
  httpServer.prependListener('request', (request: IncomingMessage) => {
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      request.socket.destroy();
      return;
    }
    let received = 0;
    request.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) request.socket.destroy();
    });
  });
}
