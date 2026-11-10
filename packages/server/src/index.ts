/**
 * Entry point of the world server: `PORT=<n> pnpm --filter @novaland/server dev`.
 * Reads the port from the environment, draws a random seed for this boot and
 * starts the one world room. The seed is logged so a session can be replayed.
 */
import { TICK_RATE } from '@novaland/sim';
import { randomInt } from 'node:crypto';
import { startWorldServer } from './world/startWorldServer';
import { DEFAULT_PORT, IDLE_TIMEOUT_MS, MAX_SEATS, SEND_RATE } from './world/tuning';

const port = readPort(process.env.PORT);
const idleTimeoutMs = readIdleTimeoutMs(process.env.IDLE_TIMEOUT_SECONDS);
const seed = randomInt(0, 2 ** 31);
const server = await startWorldServer({ port, seed, idleTimeoutMs });
console.log(JSON.stringify({ event: 'world-room-listening', port: server.port, roomId: server.roomId, seed, seats: MAX_SEATS, tickRate: TICK_RATE, sendRate: SEND_RATE, idleTimeoutSeconds: idleTimeoutMs / 1000 }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ event: 'world-room-stopping', signal, tick: server.room.tick, seatsTaken: server.room.seatsTaken, dropped: server.room.dropped, idleSeatsFreed: server.room.idleSeatsFreed }));
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

/** The idle timeout in `IDLE_TIMEOUT_SECONDS` as milliseconds, or the tuned default when unset. Anything under a second, or not a number, stops the boot, like a bad `PORT`: a shorter timeout would kick every player before their first send. */
function readIdleTimeoutMs(value: string | undefined): number {
  if (value === undefined || value === '') return IDLE_TIMEOUT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds * 1000) || seconds < 1) {
    console.error(`IDLE_TIMEOUT_SECONDS must be a number of seconds, at least 1, got ${JSON.stringify(value)}`);
    process.exit(1);
  }
  return seconds * 1000;
}
