/**
 * A Node observer of the world: joins the room at <endpoint> as a sixth eye
 * (no browser, no Origin header), builds a replica from the welcome and the
 * deltas, and prints one JSON line every `SAMPLE_MS` with every player's
 * position and move intent until it is stopped. The browser checks use it to
 * see, from the authoritative world, that the pages they drive are seated
 * and that their key presses move their avatars: production builds expose no
 * debug API, so the pages cannot be asked.
 *
 * Usage: tsx observer.ts <endpoint>   (run with the server package's tsx)
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applyWorldState, createReplica, findLevel, findPlayerEntity, getHeading, getRenderables, WIRE, type ReplicaHandle, type WelcomeMessage } from '../../packages/sim/src/index.ts';

const serverPackage = new URL('../../packages/server/package.json', import.meta.url);
const { Client } = (await import(pathToFileURL(createRequire(serverPackage).resolve('@colyseus/sdk')).href)) as typeof import('@colyseus/sdk');

const endpoint = process.argv[2];
if (!endpoint) throw new Error('usage: tsx observer.ts <endpoint>');
const SAMPLE_MS = 100;
const SEATS = 5;

const client = new Client(endpoint);
const room = await client.joinById('world');
room.reconnection.enabled = false;
let replica: ReplicaHandle | undefined = undefined;
const pending: unknown[] = [];
room.onMessage(WIRE.delta, (delta: unknown) => (replica ? applyWorldState(replica, delta) : pending.push(delta)));
room.onMessage(WIRE.state, (state: unknown) => (replica ? applyWorldState(replica, state) : pending.push(state)));
const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, resolve));
const level = findLevel(welcome.level);
if (!level) throw new Error(`unknown level ${welcome.level}`);
replica = createReplica({ level, capacity: welcome.capacity });
applyWorldState(replica, welcome.state);
for (const update of pending.splice(0)) applyWorldState(replica, update);
say({ event: 'welcomed', slot: welcome.slot, tick: welcome.state.tick });

const timer = setInterval(() => {
  if (!replica) return;
  const renderables = getRenderables(replica);
  const players = [];
  for (let slot = 0; slot < SEATS; slot += 1) {
    const eid = findPlayerEntity(replica, slot);
    if (eid === undefined) continue;
    const renderable = renderables.find((candidate) => candidate.eid === eid);
    const heading = getHeading(replica, eid);
    if (!renderable || !heading) continue;
    players.push({ slot, eid, x: round(renderable.x), y: round(renderable.y), intentX: heading.moveIntent.x, intentY: heading.moveIntent.y });
  }
  say({ event: 'world', tick: replica.tick, ownEntity: findPlayerEntity(replica, welcome.slot), players });
}, SAMPLE_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    void room.leave().finally(() => process.exit(0));
  });
}

function say(line: object): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
