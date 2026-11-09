/**
 * Entry point of the world server: `PORT=<n> pnpm --filter @novaland/server dev`.
 * Reads the port from the environment, draws a random seed for this boot and
 * starts the one world room. The seed is logged so a session can be replayed.
 */
import { TICK_RATE } from '@novaland/sim';
import { randomInt } from 'node:crypto';
import { startWorldServer } from './world/startWorldServer';
import { DEFAULT_PORT, MAX_SEATS, SEND_RATE } from './world/tuning';

const port = readPort(process.env.PORT);
const seed = randomInt(0, 2 ** 31);
const server = await startWorldServer({ port, seed });
console.log(JSON.stringify({ event: 'world-room-listening', port: server.port, roomId: server.roomId, seed, seats: MAX_SEATS, tickRate: TICK_RATE, sendRate: SEND_RATE }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ event: 'world-room-stopping', signal }));
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
