import type { Client as ServerClient } from '@colyseus/core';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  applyWorldState,
  createReplica,
  findLevel,
  findPlayerEntity,
  getHeading,
  getRenderables,
  JOIN_REFUSAL,
  WIRE,
  type Heading,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateApplyResult,
  type WorldStateUpdate,
} from '@novaland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_KICK } from './kicks';
import { startWorldServer, type WorldServer } from './startWorldServer';
import {
  DISCONNECT_MESSAGES_PER_SECOND,
  IDLE_TIMEOUT_MS,
  INBOUND_BURST,
  INBOUND_MESSAGES_PER_SECOND,
  JOIN_ACK_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_INBOUND_BYTES,
  MAX_REQUEST_BODY_BYTES,
  MAX_SEATS,
  RESYNC_BURST,
  RESYNCS_PER_SECOND,
  WORLD_ROOM_ID,
} from './tuning';
import { WorldRoom, type Clock } from './WorldRoom';

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
    await waitForUpdates(players, 2);
    const mover = players[0] as Player;
    const before = players.map((player) => positionOf(player.replica, mover.welcome.slot));
    mover.room.send(WIRE.move, { x: 1, y: 0 });
    await waitUntil(() => players.every((player, index) => positionOf(player.replica, mover.welcome.slot).x > before[index]!.x + 0.1));
    for (const player of players) {
      expect(player.applyResults.every((result) => result === 'applied'), player.applyResults.join(',')).toBe(true);
      expect(player.replica.tick).toBeGreaterThan(player.welcome.state.tick);
      expect(headingOf(player.replica, mover.welcome.slot)).toEqual({ moveIntent: { x: 1, y: 0 }, facing: { x: 1, y: 0 } });
      for (let seat = 1; seat < MAX_SEATS; seat += 1) expect(headingOf(player.replica, seat).moveIntent).toEqual({ x: 0, y: 0 });
    }
    // Every replica draws every avatar where the server put it. Replicas are compared at one tick: each applies its deltas as its socket drains.
    await waitUntil(() => players.every((player) => player.replica.tick === mover.replica.tick));
    for (const player of players) expect(getRenderables(player.replica)).toEqual(getRenderables(mover.replica));
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
    await expect(sixth.reconnect('world:token')).rejects.toThrow(/invalid method/);
  });

  it('frees the seat of a player who leaves, removes their avatar for the others, and seats the next joiner there', async () => {
    server = await startWorldServer({ port: 0, seed: 4 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 1);
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
    await waitForUpdates(players, 2);
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
    await waitForUpdates(players, 4);
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

  it("spends a flooding player's budget instead of the sim, and disconnects a frame the transport refuses", async () => {
    server = await startWorldServer({ port: 0, seed: 6 });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 1);
    const [flooder, watcher] = players as [Player, Player];
    // Under Colyseus's own per-second ceiling, so what acts here is the room's budget, which drops instead of disconnecting.
    const flood = DISCONNECT_MESSAGES_PER_SECOND - 5;
    const tickBefore = server.room.tick;
    const floodStartedAt = performance.now();
    for (let i = 0; i < flood; i += 1) flooder.room.send(WIRE.move, { x: i % 2 === 0 ? 1 : -1, y: 0 });
    await waitForUpdates(players, 3);
    // The budget refills while the flood is in flight; allow what that much time could have refilled, plus one for rounding.
    const refilled = Math.ceil(((performance.now() - floodStartedAt) / 1000) * INBOUND_MESSAGES_PER_SECOND) + 1;
    expect(server.room.dropped.overBudget).toBeGreaterThanOrEqual(flood - INBOUND_BURST - refilled);
    expect(server.room.clients.length).toBe(2);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);

    const left = new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code)));
    flooder.room.send(WIRE.move, { x: 1, y: 0, padding: 'p'.repeat(MAX_FRAME_BYTES * 2) });
    expect(await left).toBe(1009);
    await waitUntil(() => findPlayerEntity(watcher.replica, flooder.welcome.slot) === undefined);
    expect(server.room.seatsTaken).toBe(1);
    expect(server.room.tick).toBeGreaterThan(tickBefore + 5);
    players.splice(players.indexOf(flooder), 1);
  });

  it('closes a session that floods unknown message types once its budget is spent, and keeps the others', async () => {
    server = await startWorldServer({ port: 0, seed: 8 });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    const [flooder, watcher] = players as [Player, Player];
    const left = new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code)));
    // Between the room's budget and Colyseus's own per-second ceiling, so only the room's guard can close the socket.
    const flood = INBOUND_BURST + 10;
    expect(flood).toBeLessThan(DISCONNECT_MESSAGES_PER_SECOND);
    for (let i = 0; i < flood; i += 1) flooder.room.send('nonsense', i);
    expect(await left).toBe(CloseCode.WITH_ERROR);
    expect(server.room.dropped.unknownType).toBeGreaterThan(INBOUND_BURST);
    expect(server.room.dropped.unknownType).toBeLessThanOrEqual(flood);
    await waitUntil(() => findPlayerEntity(watcher.replica, flooder.welcome.slot) === undefined);
    players.splice(players.indexOf(flooder), 1);
    await waitForUpdates(players, 2);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it('answers world/resync with a full state the replica applies, and gives a resync flood only its own small budget', async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    players.push(await join(server.port));
    const player = players[0] as Player;
    await waitForUpdates(players, 1);
    const fullStates = () => player.updates.filter((update) => update.kind === 'full').length;
    const before = fullStates();
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    await waitUntil(() => fullStates() > before);
    await waitForUpdates(players, 2);
    // Three requests, one state: the next send carries it, the ones after chain from it.
    expect(fullStates()).toBe(before + 1);
    expect(player.applyResults.every((result) => result === 'applied')).toBe(true);
    expect(player.replica.tick).toBe(player.updates.at(-1)?.tick);
    // A request every send for a while: the resync budget, not the move budget, bounds the full states that come back.
    const floodStartedAt = performance.now();
    for (let i = 0; i < 20; i += 1) {
      player.room.send(WIRE.resync);
      await waitForUpdates(players, 1);
    }
    const refilled = Math.ceil(((performance.now() - floodStartedAt) / 1000) * RESYNCS_PER_SECOND) + 1;
    expect(fullStates() - before).toBeLessThanOrEqual(RESYNC_BURST + refilled);
    expect(server.room.dropped.overBudget).toBeGreaterThan(10);
  });

  it(`closes a connection that never acknowledges its join after ${JOIN_ACK_TIMEOUT_MS} ms and frees the seat`, async () => {
    server = await startWorldServer({ port: 0, seed: 9 });
    players.push(await join(server.port));
    const watcher = players[0] as Player;
    const reservation = await reserveSeat(server.port);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`);
    const closed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)));
    await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
    // The seat is taken and the player spawned, but nothing is sent to a session that cannot receive yet: Colyseus
    // would hold every send in its per-client queue until the acknowledgement, so that queue must stay at the welcome alone.
    await waitUntil(() => server!.room.seatsTaken === 2 && findPlayerEntity(watcher.replica, 1) !== undefined);
    const queued = () => (server!.room.clients.find((client) => client.sessionId === reservation.sessionId) as { _enqueuedMessages?: unknown[] } | undefined)?._enqueuedMessages?.length;
    expect(queued()).toBe(1);
    await waitForUpdates(players, 10);
    expect(queued()).toBe(1);
    expect(await closed).toBe(CloseCode.WITH_ERROR);
    await waitUntil(() => server!.room.seatsTaken === 1 && findPlayerEntity(watcher.replica, 1) === undefined);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it(`frees the seat of a session with no accepted input for ${IDLE_TIMEOUT_MS / 60000} minutes, closing it with ${IDLE_KICK.code} "${IDLE_KICK.reason}", and keeps one that plays`, async () => {
    const clock = fakeClock();
    server = await startWorldServer({ port: 0, seed: 13, clock });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    const [idler, walker] = players as [Player, Player];
    const idlerLeft = new Promise<[number, string | undefined]>((resolve) => idler.room.onLeave((code, reason) => resolve([code, reason])));
    let walkerLeftWith: number | undefined;
    walker.room.onLeave((code) => (walkerLeftWith = code));
    await waitForUpdates(players, 1);
    // Most of the timeout passes with nobody playing: nobody is kicked yet. The minute left is slack for real time on a slow machine; the fake clock makes it free.
    clock.skip(IDLE_TIMEOUT_MS - 60_000);
    await waitForUpdates(players, 3);
    expect(server.room.clients.length).toBe(2);
    expect(server.room.idleSeatsFreed).toBe(0);
    // The walker plays once, just before the deadline. The idler only sends a move that fails the gate, which is not input: only the idler crosses the deadline.
    walker.room.send(WIRE.move, { x: 0, y: 1 });
    idler.room.send(WIRE.move, { x: 1 });
    await waitUntil(() => headingOf(walker.replica, walker.welcome.slot).moveIntent.y === 1 && server!.room.dropped.malformed === 1);
    clock.skip(61_000);
    expect(await idlerLeft).toEqual([IDLE_KICK.code, IDLE_KICK.reason]);
    expect(server.room.idleSeatsFreed).toBe(1);
    expect(walkerLeftWith).toBeUndefined();
    // The leave reached the sim: the idler's avatar is gone for the walker, and its seat goes to the next joiner.
    await waitUntil(() => findPlayerEntity(walker.replica, idler.welcome.slot) === undefined);
    expect(server.room.seatsTaken).toBe(1);
    players.splice(players.indexOf(idler), 1);
    const next = await join(server.port);
    players.push(next);
    expect(next.welcome.slot).toBe(idler.welcome.slot);
    expect(walker.applyResults.every((result) => result === 'applied')).toBe(true);
    // The walker's own timeout runs from its last accepted move, not from its join: most of it is still ahead of it.
    clock.skip(IDLE_TIMEOUT_MS - 120_000);
    await waitForUpdates(players, 3);
    expect(walkerLeftWith).toBeUndefined();
    expect(server.room.idleSeatsFreed).toBe(1);
    expect(server.room.clients.length).toBe(2);
    // Past it, the walker goes; so does `next`, which joined a whole timeout ago and never played (the cleanup copes: a left room's `leave` resolves at once).
    clock.skip(120_000);
    await waitUntil(() => walkerLeftWith !== undefined);
    expect(walkerLeftWith).toBe(IDLE_KICK.code);
    expect(IDLE_KICK.code).not.toBe(CloseCode.WITH_ERROR);
    expect(IDLE_KICK.code).not.toBe(CloseCode.CONSENTED);
  });

  it('closes the connection of an oversized HTTP request before reading its body, and keeps serving joins', async () => {
    server = await startWorldServer({ port: 0, seed: 10 });
    const url = `http://127.0.0.1:${server.port}/matchmake/joinById/${WORLD_ROOM_ID}`;
    const big = 'x'.repeat(MAX_REQUEST_BODY_BYTES * 256);
    const refused = await fetch(url, { method: 'POST', body: big, headers: { 'content-type': 'application/json' } }).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(refused);
    // Chunked, so no content-length to refuse up front: the stream is cut once it passes the cap.
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 64; i += 1) controller.enqueue(new TextEncoder().encode('y'.repeat(MAX_REQUEST_BODY_BYTES)));
        controller.close();
      },
    });
    const refusedChunked = await fetch(url, { method: 'POST', body: chunked, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(refusedChunked);
    // A small body still reaches Colyseus whole: the reservation it answers with is what a join starts from.
    expect(await reserveSeat(server.port)).toMatchObject({ roomId: WORLD_ROOM_ID });
    expect(server.room.seatsTaken).toBe(0);
    players.push(await join(server.port));
    expect(players[0]?.welcome.slot).toBe(0);
  });
});

describe('WorldRoom driven directly', () => {
  it('frees the seat of a client that leaves while its join is waiting for a tick, and refuses a join when every seat is held', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 11 });
    try {
      const leaverClient = fakeClient('leaver');
      const joining = room.onJoin(leaverClient);
      room.onLeave(leaverClient);
      await joining;
      expect(room.seatsTaken).toBe(0);
      // Both commands landed in the same tick, in order: the player was spawned and removed before the welcome state was taken.
      expect(leaverClient.sent.map(([type]) => type)).toEqual([WIRE.welcome]);
      const welcome = leaverClient.sent[0]?.[1] as WelcomeMessage;
      expect(welcome.state.entities.some((entity) => entity.components['Player'] !== undefined)).toBe(false);
      for (let seat = 0; seat < MAX_SEATS; seat += 1) await room.onJoin(fakeClient(`sitter-${seat}`));
      expect(room.seatsTaken).toBe(MAX_SEATS);
      await expect(room.onJoin(fakeClient('sixth'))).rejects.toThrow(JOIN_REFUSAL.worldFull);
    } finally {
      room.onDispose();
    }
  });

  it('fails a join that is waiting for a tick when the room is disposed instead of hanging it', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 12 });
    const joining = room.onJoin(fakeClient('late'));
    room.onDispose();
    await expect(joining).rejects.toThrow(/shutting down/);
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

/**
 * Joins the world the way the browser client will and keeps a replica in step
 * with what the server sends. The update handlers are registered before the
 * welcome is awaited: a delta can arrive in the same batch as the welcome, and
 * the SDK drops a message that has no handler yet.
 */
async function join(port: number): Promise<Player> {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinById(WORLD_ROOM_ID);
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
  return { room, welcome, replica, updates, applyResults };
}

/** A seat reservation straight from the matchmaker, for a client that will misbehave at the WebSocket stage. */
async function reserveSeat(port: number): Promise<{ sessionId: string; roomId: string; processId: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/matchmake/joinById/${WORLD_ROOM_ID}`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  return (await response.json()) as { sessionId: string; roomId: string; processId: string };
}

interface FakeClient extends ServerClient {
  readonly sent: Array<[string, unknown]>;
}

/** Enough of a Colyseus client for the room's own join and leave paths: a session id and a `send` that records. */
function fakeClient(sessionId: string): FakeClient {
  const sent: Array<[string, unknown]> = [];
  return { sessionId, sent, send: (type: string, message: unknown) => sent.push([type, message]) } as unknown as FakeClient;
}

/** A clock a test pushes forward: real time plus whatever was skipped, so the room keeps ticking while an idle timeout passes in an instant. */
function fakeClock(): Clock & { skip(ms: number): void } {
  let skippedMs = 0;
  return {
    now: () => performance.now() + skippedMs,
    skip: (ms) => {
      skippedMs += ms;
    },
  };
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
function waitForUpdates(waiting: readonly Player[], count: number): Promise<void> {
  const targets = waiting.map((player) => player.updates.length + count);
  return waitUntil(() => waiting.every((player, index) => player.updates.length >= (targets[index] as number)));
}

/** Polls `condition` until it holds; fails after `timeoutMs` (generous: the loop runs on real time). */
async function waitUntil(condition: () => boolean, timeoutMs = JOIN_ACK_TIMEOUT_MS + 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
