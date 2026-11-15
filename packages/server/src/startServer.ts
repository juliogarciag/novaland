import { createFront, type OriginPolicy } from './front';
import { MAX_SEATS, startWorldServer, type SavedPositions, type WorldServer } from './world';

export interface ServerOptions {
  /** TCP port to listen on; 0 picks a free one. Fails if it is busy. */
  readonly port: number;
  /** Seed of the one sim. */
  readonly seed: number;
  /** Which browser origins may reach the world room. */
  readonly originPolicy: OriginPolicy;
  /** The client build to serve, or undefined to serve none. */
  readonly clientDirectory: string | undefined;
  /** How long a connection may sit with no byte moving before it is closed; the front's default unless a test passes a shorter one. */
  readonly idleConnectionTimeoutMs?: number;
  /** How long a player may stand still without input before the room frees their seat (#22); the room's `IDLE_TIMEOUT_MS` unless set. Not the connection timeout above: that one is about bytes, this one about play. */
  readonly idleTimeoutMs?: number;
  /** Where returning players are put back (#55, ADR 0014). The caller opened it and closes it once the server has stopped. Without one, positions last as long as this process. */
  readonly savedPositions?: SavedPositions;
}

/**
 * Starts the whole server on one port: the world room behind the HTTP front.
 * This is the only place the two meet. The front is built first, because the
 * room listens on the front's HTTP server, and the room hands the front's
 * pieces to Colyseus's hooks. `/health` answers `503` until the room exists.
 */
export async function startServer({ port, seed, originPolicy, clientDirectory, idleConnectionTimeoutMs, idleTimeoutMs, savedPositions }: ServerOptions): Promise<WorldServer> {
  const started: { world?: WorldServer } = {};
  const front = createFront({
    originPolicy,
    clientDirectory,
    idleConnectionTimeoutMs,
    // `savedPositions` says whether a returning player survives a restart of this process: `disk` when a store was opened on one, `memory` otherwise.
    health: () => started.world && { roomId: started.world.roomId, seats: MAX_SEATS, seatsTaken: started.world.room.seatsTaken, tick: started.world.room.tick, savedPositions: savedPositions?.kind ?? 'memory' },
  });
  started.world = await startWorldServer({ port, seed, idleTimeoutMs, savedPositions, front });
  return started.world;
}
