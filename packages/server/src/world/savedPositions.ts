import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_SAVED_PLAYERS } from './tuning';

/** A point of the world in metres, as the sim reports a player's position. */
export interface SavedPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Where each known player last stood, so a player who joins again is put
 * back there (ADR 0014). A player is known by a key the inbound gate derives
 * from their token (`readPlayerKey`); the token itself never gets here. The
 * room reads a position when a player joins and saves one when they leave and
 * every few seconds in between. Nothing here reaches a client.
 */
export interface SavedPositions {
  /** `disk`: positions outlive this process. `memory`: they are gone when it stops. */
  readonly kind: 'disk' | 'memory';
  /** How many players have a saved position; never more than the store's limit. */
  readonly count: number;
  /** Where the player last stood, or undefined for a player this store has never saved. */
  find(playerKey: string): SavedPosition | undefined;
  /** Remembers where the player stands now. A position that is not two finite numbers is not saved. Never throws: a store that cannot write says so in the log and the game goes on. */
  save(playerKey: string, position: SavedPosition): void;
  /** Releases the file. Nothing can be read or saved afterwards. */
  close(): void;
}

export interface SavedPositionsOptions {
  /** The directory that holds the store's file, created if missing. Undefined keeps the positions in memory only. */
  readonly directory?: string | undefined;
  /** Most players remembered; saving one more forgets whoever was seen longest ago. `MAX_SAVED_PLAYERS` unless set. */
  readonly maxPlayers?: number;
  /** The wall clock, in milliseconds, that orders who was seen last; `Date.now` unless a test passes its own. */
  readonly now?: () => number;
}

/** Least time between two log lines about a store that fails. */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/** Name of the store's file inside its directory. */
export const SAVED_POSITIONS_FILE = 'saved-positions.sqlite';

/**
 * Opens the store: one SQLite table, in `directory` when one is given and in
 * memory otherwise, through Node's built-in `node:sqlite`. SQLite gives what a
 * hand-written file would have to earn: a save is atomic, a crash mid-write
 * leaves the last good state, and one player's save rewrites one row. The
 * calls are synchronous and take microseconds at this size (a few rows every
 * few seconds), so they run on the room's own loop.
 *
 * Throws when the directory or the file cannot be opened or is not a store
 * this code can read: whoever asked for a directory decides what that means
 * (the boot stops). Once open, a failing save is logged, at most once a
 * minute, and dropped.
 */
export function openSavedPositions({ directory, maxPlayers = MAX_SAVED_PLAYERS, now = Date.now }: SavedPositionsOptions = {}): SavedPositions {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1) throw new RangeError(`maxPlayers must be a positive whole number, got ${String(maxPlayers)}`);
  if (directory !== undefined) mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(directory === undefined ? ':memory:' : path.join(directory, SAVED_POSITIONS_FILE));
  try {
    // The key is the hash of a token, so a copy of this file names no one and opens no seat.
    database.exec(`
      CREATE TABLE IF NOT EXISTS saved_positions (
        player_key TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        seen_at INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS saved_positions_by_seen_at ON saved_positions (seen_at);
    `);
    const findRow = database.prepare('SELECT x, y FROM saved_positions WHERE player_key = ?');
    const saveRow = database.prepare('INSERT INTO saved_positions (player_key, x, y, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (player_key) DO UPDATE SET x = excluded.x, y = excluded.y, seen_at = excluded.seen_at');
    const countRows = database.prepare('SELECT COUNT(*) AS count FROM saved_positions');
    const forgetLongestUnseen = database.prepare('DELETE FROM saved_positions WHERE player_key IN (SELECT player_key FROM saved_positions ORDER BY seen_at, player_key LIMIT ?)');
    const readCount = (): number => Number(countRows.get()?.['count'] ?? 0);
    let count = readCount();
    let failureLoggedAt = -Infinity;
    let closed = false;
    // A file written with a larger limit, or by hand, is cut down to this one before anyone joins.
    if (count > maxPlayers) {
      forgetLongestUnseen.run(count - maxPlayers);
      count = readCount();
    }

    return {
      kind: directory === undefined ? 'memory' : 'disk',
      get count() {
        return count;
      },
      find(playerKey) {
        if (closed) return undefined;
        try {
          const row = findRow.get(playerKey);
          const x = row?.['x'];
          const y = row?.['y'];
          return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
        } catch (error) {
          logFailure('find', error);
          return undefined;
        }
      },
      save(playerKey, position) {
        if (closed || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
        try {
          const known = findRow.get(playerKey) !== undefined;
          saveRow.run(playerKey, position.x, position.y, Math.trunc(now()));
          if (known) return;
          count += 1;
          if (count > maxPlayers) {
            forgetLongestUnseen.run(count - maxPlayers);
            count = readCount();
          }
        } catch (error) {
          logFailure('save', error);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        database.close();
      },
    };

    /** One line a minute at most, and never the key: a full disk must not also fill the log. */
    function logFailure(operation: 'find' | 'save', error: unknown): void {
      const at = now();
      if (at - failureLoggedAt < FAILURE_LOG_INTERVAL_MS) return;
      failureLoggedAt = at;
      console.error(JSON.stringify({ event: 'saved-positions-failed', operation, error: error instanceof Error ? error.message : String(error) }));
    }
  } catch (error) {
    database.close();
    throw error;
  }
}
