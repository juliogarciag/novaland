/**
 * Node clients against a real world room booted with a short idle timeout,
 * from the perspective of the browser client (#18): one player stops playing
 * right after joining, another keeps sending moves. Prints a transcript, then
 * one JSON line with the measurements; 02-idle-kick.mjs checks it. The server
 * is a separate process (started by the runner), so the only shared code is
 * the sim's public API and the Colyseus SDK.
 *
 * Usage: tsx idleClients.ts <port> <idleTimeoutSeconds>   (run with the server package's tsx)
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  applyWorldState,
  createReplica,
  findLevel,
  findPlayerEntity,
  getHeading,
  WIRE,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateApplyResult,
  type WorldStateUpdate,
} from '../../packages/sim/src/index.ts';

// The SDK is a dependency of the server package; resolve it from there.
const serverPackage = new URL('../../packages/server/package.json', import.meta.url);
const { Client } = (await import(pathToFileURL(createRequire(serverPackage).resolve('@colyseus/sdk')).href)) as typeof import('@colyseus/sdk');
type Room = import('@colyseus/sdk').Room;

const port = Number(process.argv[2]);
const idleTimeoutSeconds = Number(process.argv[3]);
if (!Number.isInteger(port) || port <= 0 || !(idleTimeoutSeconds > 0)) throw new Error('usage: tsx idleClients.ts <port> <idleTimeoutSeconds>');
const endpoint = `ws://127.0.0.1:${port}`;
const startedAt = Date.now();

interface Player {
  readonly name: string;
  readonly room: Room;
  readonly welcome: WelcomeMessage;
  readonly replica: ReplicaHandle;
  readonly updates: WorldStateUpdate[];
  readonly applyResults: WorldStateApplyResult[];
  readonly joinedAt: number;
  leftWith: { code: number; reason: string | undefined } | undefined;
  leftAt: number | undefined;
}

// 1. Two players join. The idler never sends anything; the walker changes direction every second, each change an accepted move.
const idler = await join('idler');
const walker = await join('walker');
say(`idler seated in slot ${idler.welcome.slot}, walker in slot ${walker.welcome.slot}; idle timeout ${idleTimeoutSeconds} s`);
let moves = 0;
const walking = setInterval(() => {
  walker.room.send(WIRE.move, { x: moves % 2 === 0 ? 1 : 0, y: 0 });
  moves += 1;
}, 1000);

// 2. The idler is kicked at the timeout; the walker, seated just as long, is not.
await waitUntil(() => idler.leftWith !== undefined, (idleTimeoutSeconds + 5) * 1000);
const idlerKickedAfterSeconds = ((idler.leftAt as number) - idler.joinedAt) / 1000;
const walkerStillSeated = walker.leftWith === undefined;
say(`idler left with code ${idler.leftWith?.code} reason "${idler.leftWith?.reason}" ${idlerKickedAfterSeconds.toFixed(2)} s after joining; walker still seated: ${walkerStillSeated} (${moves} moves sent so far)`);
await waitUntil(() => findPlayerEntity(walker.replica, idler.welcome.slot) === undefined);
const avatarGoneForWalker = findPlayerEntity(walker.replica, idler.welcome.slot) === undefined;
say(`the walker no longer sees a player in slot ${idler.welcome.slot}: ${avatarGoneForWalker}`);

// 3. The walker keeps playing well past the timeout, then the kicked player rejoins into the freed seat.
await new Promise((resolve) => setTimeout(resolve, idleTimeoutSeconds * 1000));
const secondsSeatedWhileMoving = (Date.now() - walker.joinedAt) / 1000;
const walkerStillSeatedTwiceTheTimeout = walker.leftWith === undefined;
say(`walker still seated after ${secondsSeatedWhileMoving.toFixed(1)} s of moving: ${walkerStillSeatedTwiceTheTimeout}; walker's heading as the world sees it: ${JSON.stringify(headingOf(walker.replica, walker.welcome.slot)?.moveIntent)}`);
const rejoined = await join('idler-again');
await waitUntil(() => findPlayerEntity(walker.replica, rejoined.welcome.slot) !== undefined);
const seatsTakenAfterRejoin = [0, 1, 2, 3, 4].filter((slot) => findPlayerEntity(walker.replica, slot) !== undefined).length;
say(`the kicked player rejoined and was seated in slot ${rejoined.welcome.slot}; the walker sees ${seatsTakenAfterRejoin} players`);

// 4. The walker stops, as a browser does when the key is released: its own timeout runs from that last accepted move.
clearInterval(walking);
walker.room.send(WIRE.move, { x: 0, y: 0 });
moves += 1;
const stoppedAt = Date.now();
say(`walker stopped sending moves after ${moves} of them`);
await waitUntil(() => walker.leftWith !== undefined, (idleTimeoutSeconds + 5) * 1000);
const walkerKickedAfterLastMoveSeconds = ((walker.leftAt as number) - stoppedAt) / 1000;
say(`walker left with code ${walker.leftWith?.code} reason "${walker.leftWith?.reason}" ${walkerKickedAfterLastMoveSeconds.toFixed(2)} s after its last move, ${((walker.leftAt as number) - walker.joinedAt) / 1000} s after joining`);
await rejoined.room.leave().catch(() => undefined);

const allApplied = [idler, walker, rejoined].every((player) => player.applyResults.every((result) => result === 'applied'));
console.log(
  JSON.stringify({
    idleTimeoutSeconds,
    idler: { slot: idler.welcome.slot, leftWith: idler.leftWith, kickedAfterSeconds: round(idlerKickedAfterSeconds), avatarGoneForWalker },
    walker: { slot: walker.welcome.slot, movesSent: moves, stillSeatedWhenIdlerKicked: walkerStillSeated, stillSeatedTwiceTheTimeout: walkerStillSeatedTwiceTheTimeout, secondsSeatedWhileMoving: round(secondsSeatedWhileMoving), leftWith: walker.leftWith, kickedAfterLastMoveSeconds: round(walkerKickedAfterLastMoveSeconds) },
    rejoin: { slot: rejoined.welcome.slot, seatsTakenAfter: seatsTakenAfterRejoin },
    allApplied,
  }),
);
process.exit(0);

// ---- Helpers ----

async function join(name: string): Promise<Player> {
  const client = new Client(endpoint);
  const room = await client.joinById('world');
  const updates: WorldStateUpdate[] = [];
  const applyResults: WorldStateApplyResult[] = [];
  const bound: { replica?: ReplicaHandle } = {};
  const pending: WorldStateUpdate[] = [];
  const onUpdate = (update: WorldStateUpdate) => {
    updates.push(update);
    if (bound.replica) applyResults.push(applyWorldState(bound.replica, update));
    else pending.push(update);
  };
  room.onMessage(WIRE.delta, onUpdate);
  room.onMessage(WIRE.state, onUpdate);
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
  const level = findLevel(welcome.level);
  if (!level) throw new Error(`unknown level ${welcome.level}`);
  const replica = createReplica({ level, capacity: welcome.capacity });
  applyResults.push(applyWorldState(replica, welcome.state));
  for (const update of pending.splice(0)) applyResults.push(applyWorldState(replica, update));
  bound.replica = replica;
  const player: Player = { name, room, welcome, replica, updates, applyResults, joinedAt: Date.now(), leftWith: undefined, leftAt: undefined };
  room.onLeave((code, reason) => {
    player.leftWith = { code, reason };
    player.leftAt = Date.now();
  });
  return player;
}

function headingOf(replica: ReplicaHandle, slot: number) {
  const eid = findPlayerEntity(replica, slot);
  return eid === undefined ? undefined : getHeading(replica, eid);
}

async function waitUntil(condition: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

function say(line: string): void {
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${line}`);
}
