import { createSim, diffWorldState, findPlayerEntity, getRenderables, WIRE, worldState, type SimHandle, type WorldState } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from './connection';
import { FakeRoom, scriptedJoin } from './fakeRoom';
import { __testing__, OnlineWorld } from './OnlineWorld';
import { INTERPOLATION_BUFFER_TICKS, RESYNC_RETRY_AFTER_UPDATES, WORLD_SEATS } from './tuning';
import type { PlayableWorld } from '../worlds/PlayableWorld';

const { readWelcome } = __testing__;
const FRAME = 1 / 60;

describe('OnlineWorld', () => {
  it('resolves once welcomed, with a replica that holds the world, the seat and the count of players', async () => {
    const { world, server } = await seated(1);
    expect(world.sim.isReplica).toBe(true);
    expect(world.sim.level.name).toBe(server.sim.level.name);
    expect(world.sim.capacity).toBe(server.sim.capacity);
    expect(world.localSlot).toBe(1);
    expect(findPlayerEntity(world.sim, 1)).toBeDefined();
    expect(getRenderables(world.sim)).toEqual(getRenderables(server.sim));
    expect(world.occupancy).toEqual({ online: 2, seats: WORLD_SEATS });
  });

  it('never steps: the replica throws, the frame comes from server updates', async () => {
    const { world } = await seated(0);
    expect(() => world.sim.step()).toThrow(/replica/);
    expect(world.nextFrame([], FRAME).renderables).toEqual(getRenderables(world.sim));
  });

  it('follows deltas and draws between them, two send intervals behind', async () => {
    const { world, server } = await seated(0);
    const eid = findPlayerEntity(world.sim, 0) as number;
    server.sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let send = 0; send < 10; send += 1) {
      server.sim.step();
      server.sim.step();
      server.sim.step();
      server.sendDelta();
    }
    expect(world.sim.tick).toBe(server.sim.tick);
    const replicaX = positionOf(world.sim, 0);
    const drawn: number[] = [];
    const ticks: number[] = [];
    for (let frame = 0; frame < 6; frame += 1) {
      const view = world.nextFrame([], FRAME);
      drawn.push(view.renderables.find((renderable) => renderable.eid === eid)!.x);
      ticks.push(view.tick);
    }
    expect(ticks[0]).toBe(world.sim.tick - INTERPOLATION_BUFFER_TICKS);
    for (const tick of ticks) expect(tick).toBeLessThan(world.sim.tick);
    expect(new Set(drawn).size).toBe(drawn.length);
    for (const x of drawn) expect(x).toBeLessThan(replicaX);
    for (let index = 1; index < drawn.length; index += 1) expect(drawn[index]).toBeGreaterThan(drawn[index - 1]!);
  });

  it('answers a delta that does not chain with one resync request, and is whole again after the full state', async () => {
    const { world, server, room } = await seated(0);
    server.sim.step();
    server.skipSend(); // the replica misses this one
    server.sim.step();
    const missed = server.lastSent;
    room.receive(WIRE.delta, roundTrip(diffWorldState(missed, worldState(server.sim))));
    room.receive(WIRE.delta, roundTrip(diffWorldState(missed, worldState(server.sim))));
    expect(room.sentTypes).toEqual([WIRE.resync]);
    expect(world.sim.tick).toBe(1);
    server.sendFullState();
    expect(world.sim.tick).toBe(server.sim.tick);
    room.receive(WIRE.delta, roundTrip(diffWorldState(missed, worldState(server.sim))));
    expect(room.sentTypes).toEqual([WIRE.resync, WIRE.resync]);
  });

  it('asks again after enough further misses, in case the server dropped the request', async () => {
    const { room, server } = await seated(0);
    server.sim.step();
    server.skipSend();
    server.sim.step();
    const missed = server.lastSent;
    for (let miss = 0; miss < RESYNC_RETRY_AFTER_UPDATES * 2 + 1; miss += 1) {
      room.receive(WIRE.delta, roundTrip(diffWorldState(missed, worldState(server.sim))));
    }
    expect(room.sentTypes).toEqual([WIRE.resync, WIRE.resync, WIRE.resync]);
  });

  it('asks for a full state once online when the welcome carried a state the replica refused, and is whole after it', async () => {
    const sim = await createSim({ seed: 3 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    const server = new FakeServer(sim);
    const { join, rooms } = scriptedJoin(['room']);
    const statuses: ConnectionStatus[] = [];
    const { seated } = OnlineWorld.join({ endpoint: 'ws://world.test', join, onStatus: (status) => statuses.push(status) });
    const room = await nextRoom({ rooms }, 0);
    room.receive(WIRE.welcome, { slot: 0, level: sim.level.name, capacity: sim.capacity, state: { kind: 'delta', fromTick: 0, tick: 1, changed: [], removed: [] } });
    const world = await seated;
    expect(statuses.at(-1)).toEqual({ kind: 'online', slot: 0 });
    expect(room.sentTypes).toEqual([WIRE.resync]);
    expect(world.sim.hasState).toBe(false);
    server.room = room;
    server.sendFullState();
    expect(world.sim.hasState).toBe(true);
    expect(findPlayerEntity(world.sim, 0)).toBeDefined();
    expect(world.nextFrame([], FRAME).renderables).toEqual(getRenderables(world.sim));
  });

  it('counts malformed updates and sends nothing for them', async () => {
    const { world, room } = await seated(0);
    room.receive(WIRE.delta, { kind: 'nonsense' });
    room.receive(WIRE.state, 'full');
    room.receive(WIRE.delta, null);
    expect(world.malformedUpdates).toBe(3);
    expect(room.sent).toEqual([]);
  });

  it('sends the move of a player/move command without its slot, and nothing for other commands', async () => {
    const { world, room } = await seated(3);
    world.nextFrame([{ type: 'player/move', slot: 3, x: 0, y: -1 }, { type: 'player/join', slot: 3 }], FRAME);
    expect(room.sent).toEqual([{ type: WIRE.move, payload: { x: 0, y: -1 } }]);
  });

  it('sends a queued player/move at once, drops a queued join, and offers no seat picking (the server seats players)', async () => {
    const { world, room } = await seated(3);
    world.queueCommand({ type: 'player/join', slot: 4 });
    world.queueCommand({ type: 'player/move', slot: 3, x: 1, y: 0 });
    expect(room.sent).toEqual([{ type: WIRE.move, payload: { x: 1, y: 0 } }]);
    const playable: PlayableWorld = world;
    expect(playable.joinAnotherSeat).toBeUndefined();
  });

  it('after a drop takes the new seat and the new state from the next welcome, and repeats the move still held', async () => {
    const { world, room, server, join, statuses } = await seated(0);
    world.nextFrame([{ type: 'player/move', slot: 0, x: 1, y: 1 }], FRAME);
    room.drop(1006);
    expect(statuses.at(-1)?.kind).toBe('disconnected');
    expect(world.localSlot).toBe(0);
    world.nextFrame([], FRAME); // still draws while disconnected
    const secondRoom = await nextRoom(join, 1);
    server.sim.step([{ type: 'player/leave', slot: 0 }, { type: 'player/join', slot: 4 }]);
    server.welcome(secondRoom, 4);
    expect(statuses.at(-1)).toEqual({ kind: 'online', slot: 4 });
    expect(world.localSlot).toBe(4);
    expect(findPlayerEntity(world.sim, 0)).toBeUndefined();
    expect(findPlayerEntity(world.sim, 4)).toBeDefined();
    expect(secondRoom.sent).toEqual([{ type: WIRE.move, payload: { x: 1, y: 1 } }]);
    expect(world.nextFrame([], FRAME).renderables).toEqual(getRenderables(world.sim));
  });

  it('reports a server it cannot play on: an unknown level, a capacity out of range, a welcome of the wrong shape', async () => {
    for (const [welcome, reason] of [
      [{ slot: 0, level: 'moon-base', capacity: 1024, state: emptyState() }, /no level named "moon-base"/],
      [{ slot: 0, level: 'starter', capacity: 1e9, state: emptyState() }, /capacity/],
      [{ slot: -1, level: 'starter', capacity: 1024, state: emptyState() }, /does not understand/],
      [{ slot: 0, level: 'x'.repeat(65), capacity: 1024, state: emptyState() }, /does not understand/],
    ] as const) {
      const statuses: ConnectionStatus[] = [];
      const { join, rooms } = scriptedJoin(['room']);
      void OnlineWorld.join({ endpoint: 'ws://world.test', join, onStatus: (status) => statuses.push(status) });
      const room = await nextRoom({ rooms }, 0);
      room.receive(WIRE.welcome, welcome);
      const last = statuses.at(-1);
      expect(last?.kind).toBe('incompatible');
      if (last?.kind === 'incompatible') expect(last.reason).toMatch(reason);
      expect(room.left).toBe(true);
    }
  });

  it('after a drop refuses a welcome for another world, so the page can reload', async () => {
    const { room, join, statuses, server } = await seated(0);
    room.drop(1006);
    const secondRoom = await nextRoom(join, 1);
    secondRoom.receive(WIRE.welcome, { slot: 0, level: server.sim.level.name, capacity: server.sim.capacity + 1, state: emptyState() });
    expect(statuses.at(-1)).toEqual({ kind: 'incompatible', reason: 'the server changed its world' });
  });
});

describe('readWelcome', () => {
  it('accepts the wire shape and refuses anything else', () => {
    const welcome = { slot: 0, level: 'starter', capacity: 1024, state: emptyState() };
    expect(readWelcome(welcome)).toEqual(welcome);
    expect(readWelcome({ ...welcome, slot: 1.5 })).toBeUndefined();
    expect(readWelcome({ ...welcome, slot: 1025 })).toBeUndefined();
    expect(readWelcome({ ...welcome, level: 'x'.repeat(64) })).toBeDefined();
    expect(readWelcome({ ...welcome, level: 'x'.repeat(65) })).toBeUndefined();
    expect(readWelcome({ ...welcome, slot: '0' })).toBeUndefined();
    expect(readWelcome({ ...welcome, level: 7 })).toBeUndefined();
    expect(readWelcome({ ...welcome, capacity: '1024' })).toBeUndefined();
    expect(readWelcome({ ...welcome, state: null })).toBeUndefined();
    expect(readWelcome(null)).toBeUndefined();
    expect(readWelcome([])).toBeUndefined();
  });
});

// ---- Helpers ----

/** The authoritative side of the tests: a real sim and the messages a room would send about it. */
class FakeServer {
  lastSent: WorldState;
  room: FakeRoom | undefined;

  constructor(readonly sim: SimHandle) {
    this.lastSent = worldState(sim);
  }

  welcome(room: FakeRoom, slot: number): void {
    this.room = room;
    this.lastSent = worldState(this.sim);
    room.receive(WIRE.welcome, roundTrip({ slot, level: this.sim.level.name, capacity: this.sim.capacity, state: this.lastSent }));
  }

  sendDelta(): void {
    const next = worldState(this.sim);
    this.room?.receive(WIRE.delta, roundTrip(diffWorldState(this.lastSent, next)));
    this.lastSent = next;
  }

  /** A send that never reaches the client: the next delta chains from a state the replica never saw. */
  skipSend(): void {
    this.lastSent = worldState(this.sim);
  }

  sendFullState(): void {
    this.lastSent = worldState(this.sim);
    this.room?.receive(WIRE.state, roundTrip(this.lastSent));
  }
}

/** A world connected and welcomed into `slot`, with another player already in seat 0 or 1 so there is someone else to count. */
async function seated(slot: number) {
  const sim = await createSim({ seed: 7 });
  const otherSlot = slot === 0 ? 1 : 0;
  sim.step([{ type: 'player/join', slot: otherSlot }, { type: 'player/join', slot }]);
  const server = new FakeServer(sim);
  const statuses: ConnectionStatus[] = [];
  const join = scriptedJoin(['room', 'room', 'room']);
  const { connection, seated } = OnlineWorld.join({ endpoint: 'ws://world.test', join: join.join, onStatus: (status) => statuses.push(status) });
  expect(connection.status.kind).toBe('connecting');
  const room = await nextRoom(join, 0);
  server.welcome(room, slot);
  const world = await seated;
  expect(world.connection).toBe(connection);
  return { world, server, room, join, statuses };
}

/** Waits for the connection to join its `index`-th room (joins resolve on microtasks; a retry waits on a timer). */
async function nextRoom(join: { rooms: FakeRoom[] }, index: number): Promise<FakeRoom> {
  const deadline = Date.now() + 3000;
  while (!join.rooms[index]) {
    if (Date.now() > deadline) throw new Error(`room ${index} was never joined`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return join.rooms[index] as FakeRoom;
}

function positionOf(handle: SimHandle, slot: number): number {
  const eid = findPlayerEntity(handle, slot);
  return getRenderables(handle).find((renderable) => renderable.eid === eid)!.x;
}

/** What the network does to a payload. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyState(): WorldState {
  return { kind: 'full', tick: 0, entities: [] };
}
