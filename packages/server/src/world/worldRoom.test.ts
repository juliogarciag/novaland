import { Client, type Room } from '@colyseus/sdk';
import {
  applyWorldState,
  createReplica,
  findLevel,
  findPlayerEntity,
  getHeading,
  getRenderables,
  WIRE,
  type Heading,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateApplyResult,
  type WorldStateUpdate,
} from '@novaland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorldServer, type WorldServer } from './startWorldServer';
import { INBOUND_BURST, MAX_FRAME_BYTES, MAX_INBOUND_BYTES, MAX_SEATS, WORLD_ROOM_ID } from './tuning';

/**
 * The room from the network side: a real Colyseus server on a free port and
 * real SDK clients that build a replica from what they receive, exactly as the
 * browser client will. Every test boots its own server and stops it.
 */
describe('WorldRoom over a real connection', () => {
  afterEach(async () => {
    for (const player of players.splice(0)) await player.room.leave().catch(() => undefined);
    await server?.stop();
    server = undefined;
  });

  it(`seats ${MAX_SEATS} players by room id, each welcomed with its own seat and already in the world`, async () => {
    server = await startWorldServer({ port: 0, seed: 1 });
    expect(server.roomId).toBe(WORLD_ROOM_ID);
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    expect(players.map((player) => player.welcome.slot)).toEqual([0, 1, 2, 3, 4]);
    for (const player of players) {
      expect(findLevel(player.welcome.level)).toBeDefined();
      expect(player.welcome.capacity).toBe(player.replica.capacity);
      expect(player.welcome.state.kind).toBe('full');
      expect(findPlayerEntity(player.replica, player.welcome.slot)).toBeDefined();
    }
    // The last welcome holds everybody: the state is taken after the tick that spawned the joiner.
    const last = players[MAX_SEATS - 1] as Player;
    for (let seat = 0; seat < MAX_SEATS; seat += 1) expect(findPlayerEntity(last.replica, seat)).toBeDefined();
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
  });

  it('shows every player the others moving, through deltas that chain without a gap', async () => {
    server = await startWorldServer({ port: 0, seed: 2 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    await waitForDeltas(players, 2);
    const mover = players[0] as Player;
    const before = players.map((player) => positionOf(player.replica, mover.welcome.slot));
    mover.room.send(WIRE.move, { x: 1, y: 0 });
    await waitUntil(() => players.every((player, index) => positionOf(player.replica, mover.welcome.slot).x > before[index]!.x + 0.1));
    for (const player of players) {
      expect(player.applyResults.every((result) => result === 'applied'), player.applyResults.join(',')).toBe(true);
      expect(player.replica.tick).toBeGreaterThan(player.welcome.state.tick);
      expect(headingOf(player.replica, mover.welcome.slot)).toEqual({ moveIntent: { x: 1, y: 0 }, facing: { x: 1, y: 0 } });
      // Every replica draws every avatar where the server put it, and nobody else was told to move.
      for (let seat = 1; seat < MAX_SEATS; seat += 1) {
        expect(positionOf(player.replica, seat)).toEqual(positionOf(mover.replica, seat));
        expect(headingOf(player.replica, seat).moveIntent).toEqual({ x: 0, y: 0 });
      }
    }
    mover.room.send(WIRE.move, { x: 0, y: 0 });
    await waitUntil(() => players.every((player) => headingOf(player.replica, mover.welcome.slot).moveIntent.x === 0));
    for (const player of players) expect(headingOf(player.replica, mover.welcome.slot)).toEqual({ moveIntent: { x: 0, y: 0 }, facing: { x: 1, y: 0 } });
  });

  it('refuses the sixth player, and refuses to create or join rooms any other way', async () => {
    server = await startWorldServer({ port: 0, seed: 3 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    const sixth = new Client(`ws://127.0.0.1:${server.port}`);
    const refusal = await sixth.joinById(WORLD_ROOM_ID).then(() => undefined, (error: unknown) => error as { code: number; message: string });
    expect(refusal).toBeDefined();
    expect(refusal?.code).toBe(522);
    expect(refusal?.message).toMatch(/locked/);
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
    expect(server.room.clients.length).toBe(MAX_SEATS);
    await expect(sixth.joinOrCreate('world')).rejects.toThrow(/invalid method/);
    await expect(sixth.create('world')).rejects.toThrow(/invalid method/);
    await expect(sixth.join('world')).rejects.toThrow(/invalid method/);
  });

  it('frees the seat of a player who leaves, removes their avatar for the others, and seats the next joiner there', async () => {
    server = await startWorldServer({ port: 0, seed: 4 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    await waitForDeltas(players, 1);
    const leaver = players.splice(2, 1)[0] as Player;
    const leaverEid = findPlayerEntity(players[0]!.replica, 2);
    expect(leaverEid).toBeDefined();
    await leaver.room.leave();
    await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, 2) === undefined));
    expect(server.room.seatsTaken).toBe(MAX_SEATS - 1);
    for (const player of players) expect(getRenderables(player.replica).some((renderable) => renderable.eid === leaverEid)).toBe(false);
    const next = await join(server.port);
    players.push(next);
    expect(next.welcome.slot).toBe(2);
    await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, 2) !== undefined));
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
  });

  it('drops oversized, unknown, slot-carrying and malformed messages while the world keeps running', async () => {
    server = await startWorldServer({ port: 0, seed: 5 });
    for (let seat = 0; seat < 3; seat += 1) players.push(await join(server.port));
    await waitForDeltas(players, 2);
    const [sender, target, watcher] = players as [Player, Player, Player];
    const still = { moveIntent: { x: 0, y: 0 }, facing: { x: 0, y: 1 } };
    expect(headingOf(watcher.replica, sender.welcome.slot)).toEqual(still);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
    const tickBefore = server.room.tick;
    sender.room.send(WIRE.move, { x: 1, y: 0, slot: target.welcome.slot });
    sender.room.send(WIRE.move, { x: 1, y: 0, padding: 'p'.repeat(MAX_INBOUND_BYTES) });
    sender.room.send('player/teleport', { x: 0, y: 0 });
    sender.room.send('world/welcome', { slot: 1 });
    sender.room.send(WIRE.move, 'right');
    sender.room.send(WIRE.move, null);
    sender.room.send(WIRE.move, [1, 0]);
    sender.room.send(WIRE.move, { x: '1', y: 0 });
    sender.room.send(WIRE.move, { x: NaN, y: 0 });
    sender.room.send(WIRE.move, { x: 1, y: Infinity });
    sender.room.send(WIRE.move, { x: 1 });
    sender.room.send(WIRE.move);
    await waitForDeltas(players, 4);
    expect(server.room.dropped).toEqual({ unknownType: 2, oversized: 1, malformed: 9, overBudget: 0 });
    expect(server.room.tick).toBeGreaterThan(tickBefore + 5);
    expect(server.room.clients.length).toBe(3);
    // Neither the sender nor the player whose slot the payload named was told to move.
    expect(headingOf(watcher.replica, sender.welcome.slot)).toEqual(still);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
    // The gate is not the end of the sender's game: a well-formed move still goes through.
    sender.room.send(WIRE.move, { x: 1, y: 0 });
    await waitUntil(() => headingOf(watcher.replica, sender.welcome.slot).moveIntent.x === 1);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
  });

  it('spends a flooding player\'s budget instead of the sim, and disconnects a frame the transport refuses', async () => {
    server = await startWorldServer({ port: 0, seed: 6 });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    await waitForDeltas(players, 1);
    const [flooder, watcher] = players as [Player, Player];
    const flood = INBOUND_BURST * 3;
    for (let i = 0; i < flood; i += 1) flooder.room.send(WIRE.move, { x: i % 2 === 0 ? 1 : -1, y: 0 });
    await waitForDeltas(players, 3);
    expect(server.room.dropped.overBudget).toBeGreaterThanOrEqual(flood - INBOUND_BURST - 2);
    expect(server.room.clients.length).toBe(2);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);

    const left = new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code)));
    flooder.room.send(WIRE.move, { x: 1, y: 0, padding: 'p'.repeat(MAX_FRAME_BYTES * 2) });
    expect(await left).toBe(1009);
    await waitUntil(() => findPlayerEntity(watcher.replica, flooder.welcome.slot) === undefined);
    expect(server.room.seatsTaken).toBe(1);
    expect(server.room.tick).toBeGreaterThan(0);
    players.splice(players.indexOf(flooder), 1);
  });

  it('answers world/resync with a full state the replica applies', async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    players.push(await join(server.port));
    const player = players[0] as Player;
    await waitForDeltas(players, 1);
    const fullStates = () => player.updates.filter((update) => update.kind === 'full').length;
    const before = fullStates();
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    await waitUntil(() => fullStates() > before);
    await waitForDeltas(players, 2);
    // Three requests, one state: the next send carries it, the ones after chain from it.
    expect(fullStates()).toBe(before + 1);
    expect(player.applyResults.every((result) => result === 'applied')).toBe(true);
    expect(player.replica.tick).toBe(player.updates.at(-1)?.tick);
  });
});

// ---- Helpers ----

interface Player {
  readonly room: Room;
  readonly welcome: WelcomeMessage;
  readonly replica: ReplicaHandle;
  readonly updates: WorldStateUpdate[];
  readonly applyResults: WorldStateApplyResult[];
}

let server: WorldServer | undefined;
const players: Player[] = [];

/** Joins the world the way the browser client will and keeps a replica in step with what the server sends. */
async function join(port: number): Promise<Player> {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinById(WORLD_ROOM_ID);
  const updates: WorldStateUpdate[] = [];
  const applyResults: WorldStateApplyResult[] = [];
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
  const level = findLevel(welcome.level);
  if (!level) throw new Error(`unknown level ${welcome.level}`);
  const replica = createReplica({ level, capacity: welcome.capacity });
  applyResults.push(applyWorldState(replica, welcome.state));
  const onUpdate = (update: WorldStateUpdate) => {
    updates.push(update);
    applyResults.push(applyWorldState(replica, update));
  };
  room.onMessage(WIRE.delta, onUpdate);
  room.onMessage(WIRE.state, onUpdate);
  return { room, welcome, replica, updates, applyResults };
}

/** Where the player in `slot` is drawn. Players that spawn on the same tile push each other apart, so stillness is never asserted on this. */
function positionOf(replica: ReplicaHandle, slot: number): { x: number; y: number } {
  const eid = findPlayerEntity(replica, slot);
  const renderable = eid === undefined ? undefined : getRenderables(replica).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`no player in slot ${slot}`);
  return { x: renderable.x, y: renderable.y };
}

/** What the player in `slot` was told to do: the sim's own record of the commands that reached it. */
function headingOf(replica: ReplicaHandle, slot: number): Heading {
  const eid = findPlayerEntity(replica, slot);
  const heading = eid === undefined ? undefined : getHeading(replica, eid);
  if (!heading) throw new Error(`no player in slot ${slot}`);
  return heading;
}

/** Resolves once every player has received `count` more updates than it had. */
function waitForDeltas(waiting: readonly Player[], count: number): Promise<void> {
  const targets = waiting.map((player) => player.updates.length + count);
  return waitUntil(() => waiting.every((player, index) => player.updates.length >= (targets[index] as number)));
}

/** Polls `condition` until it holds; fails after `timeoutMs` (generous: the loop runs on real time). */
async function waitUntil(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
