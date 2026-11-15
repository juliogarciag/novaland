/**
 * Entry point of the world server: `PORT=<n> pnpm --filter @novaland/server dev`
 * from source, `pnpm start` for the built bundle. One process serves the built
 * client and the world room on `PORT`. This file only reads the environment
 * (`PORT`, `ALLOWED_ORIGINS`, `NODE_ENV`, `CLIENT_DIR`, `IDLE_TIMEOUT_SECONDS`,
 * `DATA_DIRECTORY`), opens the store of saved positions, draws a random seed
 * for this boot and hands them to `startServer`. The seed is logged so a
 * session can be replayed.
 */
import { TICK_RATE } from '@novaland/sim';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readOriginPolicy } from './front';
import { startServer } from './startServer';
import { DEFAULT_PORT, IDLE_TIMEOUT_MS, MAX_SEATS, openSavedPositions, SEND_RATE, type SavedPositions } from './world';

const port = readPort(process.env.PORT);
const originPolicy = originPolicyOrExit(process.env.ALLOWED_ORIGINS, process.env.NODE_ENV);
const clientDirectory = readClientDirectory(process.env.CLIENT_DIR);
const idleTimeoutMs = readIdleTimeoutMs(process.env.IDLE_TIMEOUT_SECONDS);
const dataDirectory = readDataDirectory(process.env.DATA_DIRECTORY, process.env.RAILWAY_VOLUME_MOUNT_PATH);
const savedPositions = savedPositionsOrExit(dataDirectory);
const seed = randomInt(0, 2 ** 31);
const server = await startServer({ port, seed, originPolicy, clientDirectory, idleTimeoutMs, savedPositions });
console.log(JSON.stringify({ event: 'world-room-listening', port: server.port, roomId: server.roomId, seed, seats: MAX_SEATS, tickRate: TICK_RATE, sendRate: SEND_RATE, idleTimeoutSeconds: idleTimeoutMs / 1000, clientDirectory: clientDirectory ?? null, savedPositions: savedPositions.kind, dataDirectory: dataDirectory ?? null, savedPlayers: savedPositions.count, allowedOrigins: originPolicy.allowAll ? '*' : [...originPolicy.allowedOrigins], loopbackOrigins: originPolicy.allowLoopback }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ event: 'world-room-stopping', signal, tick: server.room.tick, seatsTaken: server.room.seatsTaken, dropped: server.room.dropped, idleSeatsFreed: server.room.idleSeatsFreed }));
    // The room saves where everyone stands as it stops; only then is the store closed.
    void server
      .stop()
      .finally(() => savedPositions.close())
      .finally(() => process.exit(0));
  });
}

/** The port in `PORT`, or the default when unset. Anything else stops the boot: a typo must not silently pick another port. */
function readPort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT must be an integer from 0 to 65535, got ${JSON.stringify(value)}`);
    process.exit(1);
  }
  return port;
}

/** The idle timeout in `IDLE_TIMEOUT_SECONDS` as milliseconds, or the tuned default when unset. Anything under a second, or not a number, stops the boot, like a bad `PORT`: a value under a second is almost surely milliseconds typed as seconds, and would leave no one the time to press a key. */
function readIdleTimeoutMs(value: string | undefined): number {
  if (value === undefined || value === '') return IDLE_TIMEOUT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds * 1000) || seconds < 1) {
    console.error(`IDLE_TIMEOUT_SECONDS must be a number of seconds, at least 1, got ${JSON.stringify(value)}`);
    process.exit(1);
  }
  return seconds * 1000;
}

/**
 * Where the saved positions are kept: `DATA_DIRECTORY`, or the mount path of
 * the volume Railway attached to the service (it sets
 * `RAILWAY_VOLUME_MOUNT_PATH` by itself), or undefined when neither is set:
 * positions then live in memory and a restart forgets them, which is what a
 * dev server wants.
 */
function readDataDirectory(dataDirectory: string | undefined, volumeMountPath: string | undefined): string | undefined {
  const value = dataDirectory !== undefined && dataDirectory !== '' ? dataDirectory : volumeMountPath;
  return value === undefined || value === '' ? undefined : path.resolve(value);
}

/** The store of saved positions in `directory`, or in memory without one. A directory that was asked for and cannot hold the store stops the boot, like a bad `CLIENT_DIR`: running on would silently forget every player at the next restart. */
function savedPositionsOrExit(directory: string | undefined): SavedPositions {
  try {
    return openSavedPositions({ directory });
  } catch (error) {
    console.error(`The saved positions could not be opened in ${String(directory)}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** The origin policy for `ALLOWED_ORIGINS` and `NODE_ENV` (see `front/origins.ts`): the listed origins, plus any loopback page outside production. A malformed entry stops the boot, and so does production with nothing listed. */
function originPolicyOrExit(allowedOrigins: string | undefined, nodeEnv: string | undefined) {
  try {
    return readOriginPolicy({ allowedOrigins, allowLoopback: nodeEnv !== 'production' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * The client build to serve: `CLIENT_DIR`, or `packages/client/dist` next to
 * this package (the same relative path from `src/` and from `dist/`). When
 * neither exists the room runs alone, as it does under `pnpm dev:online`,
 * where Vite serves the client; a `CLIENT_DIR` that does not exist stops the
 * boot, because it was asked for.
 */
function readClientDirectory(value: string | undefined): string | undefined {
  if (value !== undefined && value !== '') {
    const directory = path.resolve(value);
    if (!existsSync(path.join(directory, 'index.html'))) {
      console.error(`CLIENT_DIR must hold a client build with an index.html, found none in ${directory}`);
      process.exit(1);
    }
    return directory;
  }
  const defaultDirectory = path.resolve(import.meta.dirname, '../../client/dist');
  return existsSync(path.join(defaultDirectory, 'index.html')) ? defaultDirectory : undefined;
}
