import { createEdge, type OriginPolicy } from './edge';
import { MAX_SEATS, startWorldServer, type WorldServer } from './world';

export interface ServerOptions {
  /** TCP port to listen on; 0 picks a free one. Fails if it is busy. */
  readonly port: number;
  /** Seed of the one sim. */
  readonly seed: number;
  /** Which browser origins may reach the world room. */
  readonly originPolicy: OriginPolicy;
  /** The client build to serve, or undefined to serve none. */
  readonly clientDirectory: string | undefined;
  /** How long a connection may sit with no byte moving before it is closed; the edge's default unless a test passes a shorter one. */
  readonly idleConnectionTimeoutMs?: number;
}

/**
 * Starts the whole server on one port: the world room behind the HTTP edge.
 * This is the only place the two meet. The edge is built first, because the
 * room listens on the edge's HTTP server, and the room hands the edge's
 * pieces to Colyseus's hooks. `/healthz` answers `503` until the room exists.
 */
export async function startServer({ port, seed, originPolicy, clientDirectory, idleConnectionTimeoutMs }: ServerOptions): Promise<WorldServer> {
  const started: { world?: WorldServer } = {};
  const edge = createEdge({
    originPolicy,
    clientDirectory,
    idleConnectionTimeoutMs,
    health: () => started.world && { roomId: started.world.roomId, seats: MAX_SEATS, seatsTaken: started.world.room.seatsTaken, tick: started.world.room.tick },
  });
  started.world = await startWorldServer({ port, seed, front: edge });
  return started.world;
}
