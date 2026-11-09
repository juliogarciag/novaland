import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
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
  /** The HTTP server the room listens on, so the boot can put the client files, the health check and the origin check in front of Colyseus. */
  readonly httpServer: HttpServer;
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
    httpServer,
    stop: () => gameServer.gracefullyShutdown(false),
  };
}

/**
 * Colyseus reads the whole body of every matchmaking POST before it looks at
 * the method, with no size limit, and logs a stack trace when that read is
 * cut short. So the body is read here first, the way Colyseus's own
 * `prereadRequestBodies` does, but capped: a request that declares or streams
 * more than `maxBytes` is answered 413 and its connection closed, and Colyseus
 * never sees it. Everything else reaches Colyseus's handlers with `body`
 * already set, which its router honours. Installed after `listen`, which is
 * when Colyseus binds its routes.
 */
function refuseLargeRequestBodies(httpServer: HttpServer, maxBytes: number): void {
  const colyseusHandlers = httpServer.listeners('request') as Array<(request: IncomingMessage, response: ServerResponse) => void>;
  httpServer.removeAllListeners('request');
  httpServer.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const handOver = () => {
      for (const handler of colyseusHandlers) handler.call(httpServer, request, response);
    };
    const refuse = () => {
      response.writeHead(413, { connection: 'close', 'content-length': '0' });
      response.end();
      request.socket.destroy();
    };
    const declaredBytes = Number(request.headers['content-length']);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      refuse();
      return;
    }
    const method = request.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && (declaredBytes > 0 || request.headers['transfer-encoding'] !== undefined);
    if (!hasBody) {
      handOver();
      return;
    }
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let refused = false;
    request.on('error', () => undefined);
    request.on('data', (chunk: Buffer) => {
      if (refused) return;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        refused = true;
        refuse();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (refused) return;
      (request as IncomingMessage & { body?: string }).body = Buffer.concat(chunks).toString('utf8');
      handOver();
    });
  });
}
