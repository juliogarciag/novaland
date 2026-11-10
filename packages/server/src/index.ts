/**
 * Entry point of the world server: `PORT=<n> pnpm --filter @novaland/server dev`
 * from source, `pnpm start` for the built bundle. One process serves the built
 * client and the world room on `PORT`. This file only reads the environment
 * (`PORT`, `ALLOWED_ORIGINS`, `NODE_ENV`, `CLIENT_DIR`), draws a random seed
 * for this boot and hands them to `startServer`. The seed is logged so a
 * session can be replayed.
 */
import { TICK_RATE } from '@novaland/sim';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readOriginPolicy } from './edge';
import { startServer } from './startServer';
import { DEFAULT_PORT, MAX_SEATS, SEND_RATE } from './world';

const port = readPort(process.env.PORT);
const originPolicy = originPolicyOrExit(process.env.ALLOWED_ORIGINS, process.env.NODE_ENV);
const clientDirectory = readClientDirectory(process.env.CLIENT_DIR);
const seed = randomInt(0, 2 ** 31);
const server = await startServer({ port, seed, originPolicy, clientDirectory });
console.log(JSON.stringify({ event: 'world-room-listening', port: server.port, roomId: server.roomId, seed, seats: MAX_SEATS, tickRate: TICK_RATE, sendRate: SEND_RATE, clientDirectory: clientDirectory ?? null, allowedOrigins: originPolicy.allowAll ? '*' : [...originPolicy.allowedOrigins], loopbackOrigins: originPolicy.allowLoopback }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ event: 'world-room-stopping', signal, tick: server.room.tick, seatsTaken: server.room.seatsTaken, dropped: server.room.dropped }));
    void server.stop().finally(() => process.exit(0));
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

/** The origin policy for `ALLOWED_ORIGINS` and `NODE_ENV` (see `edge/origins.ts`): the listed origins, plus any loopback page outside production. A malformed entry stops the boot, and so does production with nothing listed. */
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
