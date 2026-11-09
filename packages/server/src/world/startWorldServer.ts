import { matchMaker, Server, WebSocketTransport } from 'colyseus';
import { MAX_FRAME_BYTES, WORLD_ROOM_NAME } from './tuning';
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
 * first so the room is reachable the moment it exists.
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
  const listing = await matchMaker.createRoom(WORLD_ROOM_NAME, { seed } satisfies WorldRoomOptions);
  const room = matchMaker.getLocalRoomById(listing.roomId) as WorldRoom;
  const address = gameServer.transport.server?.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  return {
    port: boundPort,
    roomId: listing.roomId,
    room,
    stop: () => gameServer.gracefullyShutdown(false),
  };
}
