/**
 * Node test clients against a real world room, from the perspective of the
 * browser client that #18 will build: join by id, build a replica from the
 * welcome, apply every delta, read it with the view queries. Prints a
 * transcript, then one JSON line with the measurements; 02-room-clients.mjs
 * checks it. The server is a separate process (started by the runner) so the
 * only shared code is the sim's public API and the Colyseus SDK.
 *
 * Usage: tsx clients.ts <port>   (run with the server package's tsx)
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  applyWorldState,
  createReplica,
  findLevel,
  findPlayerEntity,
  getHeading,
  getRenderables,
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
if (!Number.isInteger(port) || port <= 0) throw new Error('usage: tsx clients.ts <port>');
const endpoint = `ws://127.0.0.1:${port}`;
const SEATS = 5;
const startedAt = Date.now();

interface Player {
  readonly name: string;
  readonly room: Room;
  readonly welcome: WelcomeMessage;
  readonly replica: ReplicaHandle;
  readonly updates: WorldStateUpdate[];
  readonly applyResults: WorldStateApplyResult[];
  leftWith: number | undefined;
}

// 1. Five players join by id.
const players: Player[] = [];
for (let i = 0; i < SEATS; i += 1) {
  const player = await join(`player-${i}`);
  players.push(player);
  say(`${player.name} welcomed: slot ${player.welcome.slot}, level "${player.welcome.level}", capacity ${player.welcome.capacity}, state at tick ${player.welcome.state.tick} with ${player.welcome.state.entities.length} entities; own entity ${findPlayerEntity(player.replica, player.welcome.slot)}`);
}
const slots = players.map((player) => player.welcome.slot);
const everyoneInLastWelcome = slots.every((slot) => findPlayerEntity(players[SEATS - 1]!.replica, slot) !== undefined);

// 2. Each sees the others move: every player walks a different way, every replica must agree with every other.
await waitForUpdates(players, 2);
const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }];
const positionsBefore = players.map((player) => slots.map((slot) => positionOf(player.replica, slot)));
for (const [index, player] of players.entries()) player.room.send(WIRE.move, directions[index]);
await waitUntil(() => players.every((player) => slots.every((slot, index) => headingOf(player.replica, slot)?.moveIntent.x === unit(directions[index]!).x && headingOf(player.replica, slot)?.moveIntent.y === unit(directions[index]!).y)));
await waitForUpdates(players, 6);
const seenMoving = players.map((player) => slots.map((slot, index) => {
  const before = positionsBefore[players.indexOf(player)]![index]!;
  const now = positionOf(player.replica, slot);
  return Math.hypot(now.x - before.x, now.y - before.y) > 0.1;
}));
const everyoneSeesEveryoneMove = seenMoving.every((row) => row.every(Boolean));
const replicasAgree = players.every((player) => JSON.stringify(getRenderables(player.replica)) === JSON.stringify(getRenderables(players[0]!.replica)));
say(`after ${players[0]!.updates.length} deltas every player sees all ${SEATS} avatars moving: ${everyoneSeesEveryoneMove}; the five replicas draw the same thing: ${replicasAgree}`);
for (const player of players) player.room.send(WIRE.move, { x: 0, y: 0 });
await waitUntil(() => players.every((player) => slots.every((slot) => headingOf(player.replica, slot)?.moveIntent.x === 0 && headingOf(player.replica, slot)?.moveIntent.y === 0)));

// 3. The sixth is refused.
const sixth = new Client(endpoint);
const refusal = await sixth.joinById('world').then(
  () => undefined,
  (error: { name: string; code: number; message: string }) => ({ name: error.name, code: error.code, message: error.message }),
);
say(`sixth join refused: ${refusal?.name} code ${refusal?.code} "${refusal?.message}"`);
const otherMethods: Record<string, string> = {};
for (const method of ['joinOrCreate', 'create', 'join'] as const) {
  otherMethods[method] = await sixth[method]('world').then(() => 'ALLOWED', (error: Error) => error.message);
}
say(`other matchmaking methods: ${JSON.stringify(otherMethods)}`);

// 4. A leaver frees the seat and vanishes for the others; the next joiner gets the seat.
const leaver = players.splice(2, 1)[0]!;
const leaverEid = findPlayerEntity(players[0]!.replica, leaver.welcome.slot);
const leaverCode = await leaver.room.leave();
await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, leaver.welcome.slot) === undefined));
const avatarGone = players.every((player) => !getRenderables(player.replica).some((renderable) => renderable.eid === leaverEid));
say(`${leaver.name} left (code ${leaverCode}); slot ${leaver.welcome.slot} empty on every replica, entity ${leaverEid} no longer drawn: ${avatarGone}`);
const newcomer = await join('player-5');
players.splice(2, 0, newcomer);
await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, newcomer.welcome.slot) !== undefined));
say(`${newcomer.name} joined into the freed seat: slot ${newcomer.welcome.slot}; everyone draws it again`);

// 5. Junk is dropped and the world keeps running.
const [sender, target, watcher] = [players[0]!, players[1]!, players[3]!];
const tickBefore = watcher.replica.tick;
const still = JSON.stringify({ moveIntent: { x: 0, y: 0 } });
const junk: Array<[string, unknown]> = [
  [WIRE.move, { x: 1, y: 0, slot: target.welcome.slot }],
  [WIRE.move, { x: 1, y: 0, padding: 'p'.repeat(200) }],
  ['player/teleport', { x: 0, y: 0 }],
  ['world/welcome', { slot: 0 }],
  [WIRE.move, 'right'],
  [WIRE.move, null],
  [WIRE.move, [1, 0]],
  [WIRE.move, { x: '1', y: 0 }],
  [WIRE.move, { x: NaN, y: 0 }],
  [WIRE.move, { x: 1, y: Infinity }],
  [WIRE.move, { x: 1 }],
  [WIRE.move, undefined],
];
for (const [type, payload] of junk) sender.room.send(type, payload);
for (let i = 0; i < 150; i += 1) sender.room.send(WIRE.move, { x: i % 2 ? 1 : -1, y: 0 });
await waitForUpdates(players, 6);
const intentsAfterJunk = { sender: JSON.stringify({ moveIntent: headingOf(watcher.replica, sender.welcome.slot)?.moveIntent }), target: JSON.stringify({ moveIntent: headingOf(watcher.replica, target.welcome.slot)?.moveIntent }) };
const worldKeptRunning = watcher.replica.tick > tickBefore + 10 && players.every((player) => player.leftWith === undefined);
// The flood's last 150 moves alternate; the budget lets a burst through, so the sender may end up walking. Stop it and check the gate let a good move through.
sender.room.send(WIRE.move, { x: 0, y: 0 });
await waitForUpdates(players, 6);
sender.room.send(WIRE.move, { x: 0, y: 1 });
await waitUntil(() => headingOf(watcher.replica, sender.welcome.slot)?.moveIntent.y === 1);
say(`${junk.length} junk messages and a flood of 150: the targeted slot never moved (${intentsAfterJunk.target === still}), the world advanced ${watcher.replica.tick - tickBefore} ticks, nobody was disconnected: ${worldKeptRunning}; a good move from the same sender still works`);
const oversizedLeft = new Promise<number>((resolve) => sender.room.onLeave((code) => resolve(code)));
sender.room.send(WIRE.move, { x: 1, y: 0, padding: 'p'.repeat(4000) });
const oversizedCode = await oversizedLeft;
await waitUntil(() => players.filter((player) => player !== sender).every((player) => findPlayerEntity(player.replica, sender.welcome.slot) === undefined));
say(`a 4 KB frame closed only its own connection (code ${oversizedCode}); the others keep playing and no longer see slot ${sender.welcome.slot}`);

// 6. Resync.
const resyncer = players[1]!;
const fullBefore = resyncer.updates.filter((update) => update.kind === 'full').length;
resyncer.room.send(WIRE.resync);
await waitUntil(() => resyncer.updates.filter((update) => update.kind === 'full').length > fullBefore);
say(`${resyncer.name} asked for a resync and got a full state at tick ${resyncer.updates.at(-1)?.tick}`);

const chained = players.map((player) => ({ name: player.name, updates: player.updates.length, applied: player.applyResults.every((result) => result === 'applied') }));
const deltaBytes = players.flatMap((player) => player.updates.filter((update) => update.kind === 'delta').map((update) => JSON.stringify(update).length));

console.log(JSON.stringify({
  port,
  seats: SEATS,
  slots,
  everyoneInLastWelcome,
  everyoneSeesEveryoneMove,
  replicasAgree,
  refusal,
  otherMethods,
  leaver: { slot: leaver.welcome.slot, code: leaverCode, avatarGone, newcomerSlot: newcomer.welcome.slot },
  junk: { messages: junk.length, flood: 150, targetIntent: intentsAfterJunk.target, worldKeptRunning, oversizedCloseCode: oversizedCode },
  chained,
  deltaBytes: { count: deltaBytes.length, min: Math.min(...deltaBytes), max: Math.max(...deltaBytes) },
  welcomeBytes: JSON.stringify(players[0]!.welcome).length,
}));
for (const player of players) await player.room.leave().catch(() => undefined);
process.exit(0);

// ---- Helpers ----

async function join(name: string): Promise<Player> {
  const room = await new Client(endpoint).joinById('world');
  const updates: WorldStateUpdate[] = [];
  const applyResults: WorldStateApplyResult[] = [];
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
  const level = findLevel(welcome.level);
  if (!level) throw new Error(`unknown level ${welcome.level}`);
  const replica = createReplica({ level, capacity: welcome.capacity });
  applyResults.push(applyWorldState(replica, welcome.state));
  const player: Player = { name, room, welcome, replica, updates, applyResults, leftWith: undefined };
  const onUpdate = (update: WorldStateUpdate) => {
    updates.push(update);
    applyResults.push(applyWorldState(replica, update));
  };
  room.onMessage(WIRE.delta, onUpdate);
  room.onMessage(WIRE.state, onUpdate);
  room.onLeave((code) => {
    player.leftWith = code;
  });
  return player;
}

function say(line: string): void {
  console.log(`[t+${String(Date.now() - startedAt).padStart(5)}ms] ${line}`);
}

function positionOf(replica: ReplicaHandle, slot: number): { x: number; y: number } {
  const eid = findPlayerEntity(replica, slot);
  const renderable = eid === undefined ? undefined : getRenderables(replica).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`no player in slot ${slot}`);
  return { x: renderable.x, y: renderable.y };
}

function headingOf(replica: ReplicaHandle, slot: number) {
  const eid = findPlayerEntity(replica, slot);
  return eid === undefined ? undefined : getHeading(replica, eid);
}

/** The intent the sim keeps for a direction: clamped to the unit square, scaled to unit length when longer. */
function unit({ x, y }: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(x, y);
  return length <= 1 ? { x, y } : { x: x / length, y: y / length };
}

function waitForUpdates(waiting: readonly Player[], count: number): Promise<void> {
  const targets = waiting.map((player) => player.updates.length + count);
  return waitUntil(() => waiting.every((player, index) => player.updates.length >= targets[index]!));
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
