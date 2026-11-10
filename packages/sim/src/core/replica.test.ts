import { describe, expect, it } from 'vitest';
import { starterLevel } from '../content/levels/starter';
import { DEFAULT_CAPACITY, FIXED_DT, MAX_CAPACITY } from '../content/tuning';
import { avatarDefIds, isAvatarDefId } from '../features/player/defs';
import { findPlayerEntity, getHeading } from '../features/player/queries';
import type { Command } from './commands';
import { __testing__, createReplica, createSim } from './create';
import { asEntityWorld } from './entityWorld';
import { applyWorldState, type ReplicaHandle } from './replica';
import type { SimHandle } from './sim';
import { DefRef } from './transform';
import { getRenderables } from './view';
import { DEFAULT_SEND_RATE, JOIN_REFUSAL, WIRE } from './wire';
import { diffWorldState, worldState, type WorldState, type WorldStateUpdate } from './worldState';

describe('a replica fed full world states every tick', () => {
  it('draws exactly what the sim draws, tick after tick, through JSON', async () => {
    const sim = await createSim({ seed: 11 });
    const replica = createReplica({ level: sim.level });
    for (let tick = 0; tick < TICKS; tick += 1) {
      sim.step(script(tick));
      expect(applyWorldState(replica, overTheWire(worldState(sim)))).toBe('applied');
      expectSameView(replica, sim);
    }
    expect(replica.tick).toBe(TICKS);
    expect(getRenderables(replica).length).toBeGreaterThanOrEqual(3);
    sim.destroy();
  });
});

describe('a replica fed deltas at a send rate', () => {
  it.each([1, 3])('matches the sim at every send with a delta every %i tick(s), through joins, leaves and a recycled entity id', async (sendEvery) => {
    const sim = await createSim({ seed: 11 });
    const replica = createReplica({ level: sim.level });
    const server = new FakeServer(sim);
    expect(applyWorldState(replica, overTheWire(server.fullState()))).toBe('applied');
    const seen = { joins: 0, leaves: 0 };
    let leaverEid: number | undefined;
    for (let tick = 0; tick < TICKS; tick += 1) {
      const commands = script(tick);
      seen.joins += commands.filter((command) => command.type === 'player/join').length;
      seen.leaves += commands.filter((command) => command.type === 'player/leave').length;
      if (commands.some((command) => command.type === 'player/leave')) leaverEid = findPlayerEntity(sim, 1);
      sim.step(commands);
      if (tick % sendEvery === 0) {
        const delta = server.delta();
        expect(applyWorldState(replica, overTheWire(delta))).toBe('applied');
        expectSameView(replica, sim);
      }
    }
    // The script makes slot 1 leave and slot 3 join afterwards; bitECS gives the newcomer the freed id, so the
    // run really covers a recycled id with a different history on each side.
    expect(seen).toEqual({ joins: 4, leaves: 1 });
    expect(leaverEid).toBeDefined();
    expect(findPlayerEntity(sim, 3)).toBe(leaverEid);
    expect(findPlayerEntity(sim, 1)).toBeUndefined();
    expect(findPlayerEntity(replica, 1)).toBeUndefined();
    expect(findPlayerEntity(replica, 3)).toBe(leaverEid);
    sim.destroy();
  });

  it('never sends the terrain again: deltas carry only the players that moved', async () => {
    const sim = await createSim({ seed: 11 });
    const server = new FakeServer(sim);
    const full = server.fullState();
    for (let tick = 0; tick < 30; tick += 1) sim.step(script(tick));
    const delta = server.delta();
    const terrainIds = new Set(full.entities.filter((entity) => entity.components['TerrainCollider']).map((entity) => entity.id));
    expect(terrainIds.size).toBeGreaterThan(10);
    expect(delta.changed.some((change) => terrainIds.has(change.id))).toBe(false);
    for (let tick = 30; tick < 40; tick += 1) sim.step(script(tick));
    const walking = server.delta();
    // Three players are walking and nothing else changes between ticks 30 and 40: one Position each.
    expect(walking.changed.length).toBe(3);
    for (const change of walking.changed) expect(Object.keys(change.components)).toEqual(['Position']);
    expect(walking.removed).toEqual([]);
    expect(JSON.stringify(walking).length).toBeLessThan(JSON.stringify(full).length / 20);
    sim.destroy();
  });

  it('removes an entity that left and reports a delta it cannot continue from', async () => {
    const sim = await createSim({ seed: 11 });
    const replica = createReplica({ level: sim.level });
    const server = new FakeServer(sim);
    applyWorldState(replica, server.fullState());
    sim.step([{ type: 'player/join', slot: 0 }, { type: 'player/join', slot: 1 }]);
    applyWorldState(replica, server.delta());
    const leaver = findPlayerEntity(replica, 1);
    expect(leaver).toBeDefined();
    sim.step([{ type: 'player/leave', slot: 1 }]);
    applyWorldState(replica, server.delta());
    expect(findPlayerEntity(replica, 1)).toBeUndefined();
    expect(getRenderables(replica).some((renderable) => renderable.eid === leaver)).toBe(false);
    expectSameView(replica, sim);

    sim.step();
    const missed = server.delta();
    sim.step();
    const next = server.delta();
    const before = worldState(replica);
    expect(applyWorldState(replica, next)).toBe('out-of-sequence');
    expect(worldState(replica)).toEqual(before);
    expect(applyWorldState(replica, missed)).toBe('applied');
    expect(applyWorldState(replica, next)).toBe('applied');
    expectSameView(replica, sim);
    sim.destroy();
  });

  it('shows each player in the avatar and at the spread spawn the sim gave it, for a full room of five', async () => {
    const sim = await createSim({ seed: 21 });
    const replica = createReplica({ level: sim.level });
    const server = new FakeServer(sim);
    applyWorldState(replica, overTheWire(server.fullState()));
    const seats = [0, 1, 2, 3, 4];
    // Joins one per tick, like a room filling up; each one goes out as its own delta.
    for (const slot of seats) {
      sim.step([{ type: 'player/join', slot }]);
      expect(applyWorldState(replica, overTheWire(server.delta()))).toBe('applied');
      expectSameView(replica, sim);
    }
    const drawnBySlot = seats.map((slot) => {
      const eid = findPlayerEntity(replica, slot) as number;
      return getRenderables(replica).find((renderable) => renderable.eid === eid);
    });
    const simDrawnBySlot = seats.map((slot) => {
      const eid = findPlayerEntity(sim, slot) as number;
      return getRenderables(sim).find((renderable) => renderable.eid === eid);
    });
    expect(drawnBySlot).toEqual(simDrawnBySlot);
    // The sim picks five different avatars (there are at least five) and five different tiles; the replica shows exactly those.
    const avatars = drawnBySlot.map((renderable) => renderable?.defId as number);
    expect(avatars.every((defId) => isAvatarDefId(defId))).toBe(true);
    expect(new Set(avatars).size).toBe(Math.min(seats.length, avatarDefIds.length));
    expect(new Set(drawnBySlot.map((renderable) => `${renderable?.x},${renderable?.y}`)).size).toBe(seats.length);
    sim.destroy();
  });

  it('a late joiner built from one full state sees the same renderables, in the same order, as the sim with its history', async () => {
    const sim = await createSim({ seed: 11 });
    // After tick 150 slot 3 has taken the entity id slot 1 freed, so bitECS iterates it last in the sim.
    for (let tick = 0; tick < 200; tick += 1) sim.step(script(tick));
    const newcomer = findPlayerEntity(sim, 3) as number;
    expect(newcomer).toBeLessThan(findPlayerEntity(sim, 2) as number);
    const lateJoiner = createReplica({ level: sim.level });
    expect(applyWorldState(lateJoiner, overTheWire(worldState(sim)))).toBe('applied');
    expectSameView(lateJoiner, sim);
    const eids = getRenderables(lateJoiner).map((renderable) => renderable.eid);
    expect(eids).toEqual([...eids].sort((a, b) => a - b));
    expect(eids.indexOf(newcomer)).toBeLessThan(eids.indexOf(findPlayerEntity(sim, 2) as number));
    sim.destroy();
  });

  it('is replaced whole by a full state, even one from an earlier tick (the server restarted)', async () => {
    const sim = await createSim({ seed: 11 });
    const replica = createReplica({ level: sim.level });
    for (let tick = 0; tick < 50; tick += 1) sim.step(script(tick));
    applyWorldState(replica, worldState(sim));
    expect(replica.tick).toBe(50);
    const restarted = await createSim({ seed: 12 });
    restarted.step([{ type: 'player/join', slot: 4 }]);
    expect(applyWorldState(replica, worldState(restarted))).toBe('applied');
    expect(replica.tick).toBe(1);
    expectSameView(replica, restarted);
    expect(findPlayerEntity(replica, 0)).toBeUndefined();
    sim.destroy();
    restarted.destroy();
  });
});

describe('createReplica', () => {
  it('is a SimHandle with the level, capacity and dt of a sim but no physics or rng', () => {
    const replica = createReplica({ level: starterLevel });
    expect(replica.level).toBe(starterLevel);
    expect(replica.capacity).toBe(DEFAULT_CAPACITY);
    expect(replica.dt).toBe(FIXED_DT);
    expect(replica.seed).toBe(0);
    expect(replica.isReplica).toBe(true);
    expect(replica.hasState).toBe(false);
    expect(replica.tick).toBe(0);
    expect(replica.entityCount).toBe(0);
    expect(getRenderables(replica)).toEqual([]);
    expect(replica.snapshot()).toMatchObject({ version: 1, level: starterLevel.name, tick: 0, rng: 0, physics: '', entities: [] });
    expect(createReplica({ level: starterLevel, capacity: 8 }).capacity).toBe(8);
    replica.destroy();
  });

  it('refuses a capacity that is not an integer in 1..MAX_CAPACITY, before allocating anything', () => {
    for (const capacity of [0, -5, 1.5, MAX_CAPACITY + 1, 1e9, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, '100' as unknown as number]) {
      expect(() => createReplica({ level: starterLevel, capacity })).toThrow(RangeError);
    }
    expect(createReplica({ level: starterLevel, capacity: 1 }).capacity).toBe(1);
    expect(createReplica({ level: starterLevel, capacity: MAX_CAPACITY }).capacity).toBe(MAX_CAPACITY);
  });

  it('refuses to step: a replica only shows what the server sent', () => {
    const replica = createReplica({ level: starterLevel });
    expect(() => replica.step()).toThrow(/cannot step/);
    expect(() => replica.step([{ type: 'player/join', slot: 0 }])).toThrow(/cannot step/);
  });

  it('only a replica takes world states; a live sim or a foreign object is refused loudly', async () => {
    const sim = await createSim({ seed: 1 });
    expect(() => applyWorldState(sim as unknown as ReplicaHandle, worldState(sim))).toThrow(TypeError);
    expect(() => applyWorldState({} as ReplicaHandle, worldState(sim))).toThrow(TypeError);
    expect(() => getRenderables({} as SimHandle)).toThrow(TypeError);
    expect(() => asEntityWorld({ tick: 0 } as SimHandle)).toThrow(TypeError);
    sim.destroy();
  });

  it('needs a full state before it takes deltas', async () => {
    const sim = await createSim({ seed: 1 });
    const replica = createReplica({ level: sim.level });
    sim.step([{ type: 'player/join', slot: 0 }]);
    const before = worldState(sim);
    sim.step();
    const delta = diffWorldState(before, worldState(sim));
    const stray = { kind: 'delta', fromTick: 0, tick: 1, changed: [{ id: 1, components: { Position: { x: 0, y: 0 } } }], removed: [] } as const;
    expect(applyWorldState(replica, stray)).toBe('out-of-sequence');
    expect(replica.hasState).toBe(false);
    expect(replica.entityCount).toBe(0);
    expect(applyWorldState(replica, before)).toBe('applied');
    expect(replica.hasState).toBe(true);
    expect(applyWorldState(replica, delta)).toBe('applied');
    expectSameView(replica, sim);
    sim.destroy();
  });

  it('a DefRef at no def is a loud bug in a live sim and a skipped entity on a replica', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    const replica = createReplica({ level: sim.level });
    applyWorldState(replica, worldState(sim));
    const player = findPlayerEntity(sim, 0) as number;
    sim.store(DefRef).id[player] = 0;
    expect(() => getRenderables(sim)).toThrow(/Unknown entity def id 0/);
    applyWorldState(replica, worldState(sim));
    expect(getRenderables(replica).some((renderable) => renderable.eid === player)).toBe(false);
    sim.destroy();
  });
});

describe('the wire contract the server and the client are built against', () => {
  it('pins the message names, the refusal reasons and the default send rate ADR 0004 lists', () => {
    expect(WIRE).toEqual({ welcome: 'world/welcome', delta: 'world/delta', state: 'world/state', resync: 'world/resync', move: 'player/move' });
    expect(JOIN_REFUSAL).toEqual({ worldFull: 'world-full' });
    expect(DEFAULT_SEND_RATE).toBe(20);
  });
});

describe('applyWorldState with data from the network', () => {
  it('ignores anything that is not a world state or delta and leaves the replica untouched', async () => {
    const { replica, sim } = await replicaInSync();
    const before = worldState(replica);
    for (const garbage of NOT_UPDATES) {
      expect(applyWorldState(replica, garbage as WorldStateUpdate)).toBe('malformed');
    }
    expect(worldState(replica)).toEqual(before);
    expectSameView(replica, sim);
    sim.destroy();
  });

  it('refuses a whole delta when one entry is malformed, and leaves the replica untouched', async () => {
    const { replica, sim } = await replicaInSync();
    const player = findPlayerEntity(sim, 0) as number;
    const tick = replica.tick;
    const before = worldState(replica);
    const good = { id: player, components: { Position: { x: 2.5, y: 2.5 } } };
    const badEntries: unknown[] = [
      null,
      'x',
      { id: 0, components: {} },
      { id: -3, components: {} },
      { id: 1.5, components: {} },
      { id: 2 ** 53, components: {} },
      { id: player },
      { id: player, components: 'nope' },
      { id: player, components: { Position: [1, 2] } },
      { id: player, components: { Facing: null } },
      { id: player, components: { Position: { x: 'far', y: 1 } } },
      { id: player, components: { MoveIntent: { x: Infinity, y: 0 } } },
      { id: player, components: { MoveIntent: { x: NaN, y: 0 } } },
      { id: player, components: {}, removedComponents: 'Facing' },
      { id: player, components: {}, removedComponents: [3, 'Facing'] },
    ];
    for (const bad of badEntries) {
      const delta = { kind: 'delta', fromTick: tick, tick: tick + 1, changed: [good, bad], removed: [] };
      expect(applyWorldState(replica, delta as unknown as WorldStateUpdate), JSON.stringify(bad)).toBe('malformed');
    }
    for (const bad of ['x', 0, -1, 1.5, null, { id: player }]) {
      const delta = { kind: 'delta', fromTick: tick, tick: tick + 1, changed: [good], removed: [bad] };
      expect(applyWorldState(replica, delta as unknown as WorldStateUpdate), JSON.stringify(bad)).toBe('malformed');
    }
    expect(replica.tick).toBe(tick);
    expect(worldState(replica)).toEqual(before);
    expectSameView(replica, sim);
    sim.destroy();
  });

  it('skips what depends on the world: ids beyond its capacity, unknown components and unknown fields', async () => {
    const { replica, sim } = await replicaInSync();
    const player = findPlayerEntity(sim, 0) as number;
    const tick = replica.tick;
    // Parsed from JSON, so `__proto__` is an own key as it would be off the wire.
    const delta: unknown = JSON.parse(
      JSON.stringify({
        kind: 'delta',
        fromTick: tick,
        tick: tick + 1,
        changed: [
          { id: replica.capacity + 1, components: { Position: { x: 1, y: 1 } } },
          { id: 2 ** 40, components: { Position: { x: 1, y: 1 } } },
          { id: player, components: { Nonsense: { x: 1 }, constructor: { x: 1 }, Position: { x: 2.5, z: 9 } } },
          { id: player, components: {}, removedComponents: ['Nonsense', 'MoveIntent'] },
        ],
        removed: [replica.capacity + 99],
      }).replace('"Nonsense":{"x":1}', '"Nonsense":{"x":1},"__proto__":{"polluted":1}'),
    );
    expect(JSON.stringify(delta)).toContain('__proto__');
    expect(applyWorldState(replica, delta as WorldStateUpdate)).toBe('applied');
    expect(replica.tick).toBe(tick + 1);
    const simView = getRenderables(sim).find((renderable) => renderable.eid === player);
    const replicaView = getRenderables(replica).find((renderable) => renderable.eid === player);
    expect(replicaView).toEqual({ ...simView, x: 2.5 });
    const components = worldState(replica).entities.find((entity) => entity.id === player)?.components ?? {};
    expect(components['MoveIntent']).toBeUndefined();
    expect(components['Facing']).toBeDefined();
    expect(components['Nonsense']).toBeUndefined();
    expect(getHeading(replica, player)).toBeUndefined();
    expect(findPlayerEntity(replica, 0)).toBe(player);
    expect(worldState(replica).entities.length).toBe(worldState(sim).entities.length);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(components)).toBe(Object.prototype);
    expect(Object.values(components).every((fields) => Object.getPrototypeOf(fields) === Object.prototype && !('polluted' in fields))).toBe(true);
    expect('polluted' in components).toBe(false);
    sim.destroy();
  });

  it('drops a null field, which is how JSON writes NaN and Infinity, and keeps the value the replica had', async () => {
    const { replica, sim } = await replicaInSync();
    const player = findPlayerEntity(sim, 0) as number;
    const tick = replica.tick;
    const positionBefore = worldState(replica).entities.find((entity) => entity.id === player)?.components['Position'];
    const wire = JSON.stringify({ kind: 'delta', fromTick: tick, tick: tick + 1, changed: [{ id: player, components: { Position: { x: Number.NaN, y: 2.5 } } }], removed: [] });
    expect(wire).toContain('"x":null');
    expect(applyWorldState(replica, JSON.parse(wire) as WorldStateUpdate)).toBe('applied');
    const positionAfter = worldState(replica).entities.find((entity) => entity.id === player)?.components['Position'];
    expect(positionAfter).toEqual({ x: positionBefore?.['x'], y: 2.5 });
    sim.destroy();
  });

  it('refuses lists longer than MAX_CAPACITY before touching the replica', async () => {
    const { replica, sim } = await replicaInSync();
    const before = worldState(replica);
    const tooMany = MAX_CAPACITY + 1;
    const entities = Array.from({ length: tooMany }, (_, index) => ({ id: index + 1, components: {} }));
    expect(applyWorldState(replica, { kind: 'full', tick: 1, entities })).toBe('malformed');
    const delta = { kind: 'delta', fromTick: replica.tick, tick: replica.tick + 1 } as const;
    expect(applyWorldState(replica, { ...delta, changed: entities, removed: [] })).toBe('malformed');
    expect(applyWorldState(replica, { ...delta, changed: [], removed: entities.map((entity) => entity.id) })).toBe('malformed');
    expect(worldState(replica)).toEqual(before);
    sim.destroy();
  });

  it('rejects a delta whose ticks do not make sense, including ticks beyond the safe integer range', async () => {
    const { replica, sim } = await replicaInSync();
    const tick = replica.tick;
    const empty = { changed: [], removed: [] };
    expect(applyWorldState(replica, { kind: 'full', tick: 2 ** 53, entities: [] })).toBe('malformed');
    expect(applyWorldState(replica, { kind: 'full', tick: 1e308, entities: [] })).toBe('malformed');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: tick, tick: 2 ** 53 + 2, ...empty })).toBe('malformed');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: tick, tick: tick - 1, ...empty })).toBe('malformed');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: -1, tick, ...empty })).toBe('malformed');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: tick + 1, tick: tick + 2, ...empty })).toBe('out-of-sequence');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: tick - 1, tick, ...empty })).toBe('out-of-sequence');
    expect(applyWorldState(replica, { kind: 'delta', fromTick: tick, tick, ...empty })).toBe('applied');
    expect(replica.tick).toBe(tick);
    sim.destroy();
  });

  it('keeps the view alive when an entity points at a def that does not exist', async () => {
    const { replica, sim } = await replicaInSync();
    const player = findPlayerEntity(sim, 0) as number;
    const tick = replica.tick;
    applyWorldState(replica, {
      kind: 'delta',
      fromTick: tick,
      tick: tick + 1,
      changed: [
        { id: player, components: { DefRef: { id: 999999 } } },
        { id: 900, components: { DefRef: { id: 424242 }, Position: { x: 0, y: 0 } } },
      ],
      removed: [],
    });
    const drawn = getRenderables(replica);
    expect(drawn.some((renderable) => renderable.eid === player || renderable.eid === 900)).toBe(false);
    expect(drawn.length).toBe(getRenderables(sim).length - 1);
    sim.destroy();
  });

  it('refuses a full state with a malformed entry whole, and drops only an entity whose id is beyond the capacity', async () => {
    const { replica, sim } = await replicaInSync();
    const before = worldState(replica);
    const good = worldState(sim).entities.slice(0, 3);
    for (const bad of [{ id: 'a', components: {} }, { id: 5, components: 4 }, 12]) {
      const state = { kind: 'full', tick: 7, entities: [...good, bad] };
      expect(applyWorldState(replica, state as unknown as WorldState), JSON.stringify(bad)).toBe('malformed');
    }
    expect(worldState(replica)).toEqual(before);
    const result = applyWorldState(replica, { kind: 'full', tick: 7, entities: [...good, { id: replica.capacity + 1, components: {} }] });
    expect(result).toBe('applied');
    expect(replica.tick).toBe(7);
    expect(worldState(replica).entities).toEqual(good);
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;
const TICKS = 300;

/** Four players: join, walk around, one leaves and a newcomer takes the freed entity id. */
function script(tick: number): Command[] {
  switch (tick) {
    case 0:
      return [{ type: 'player/join', slot: 0 }, { type: 'player/join', slot: 1 }, { type: 'player/join', slot: 2 }];
    case 1:
      return [
        { type: 'player/move', slot: 0, x: 1, y: 0 },
        { type: 'player/move', slot: 1, x: -0.3, y: 0.7 },
        { type: 'player/move', slot: 2, x: 0, y: -1 },
      ];
    case 60:
      return [{ type: 'player/move', slot: 0, x: 0.5, y: -1 }, { type: 'player/move', slot: 2, x: 0, y: 0 }];
    case 120:
      return [{ type: 'player/leave', slot: 1 }, { type: 'player/move', slot: 0, x: -1, y: -1 }];
    case 150:
      return [{ type: 'player/join', slot: 3 }, { type: 'player/move', slot: 3, x: 0, y: 1 }];
    case 240:
      return [{ type: 'player/move', slot: 3, x: 1, y: 1 }, { type: 'player/move', slot: 0, x: 0, y: 0 }];
    default:
      return [];
  }
}

/** The authoritative side of the wire: remembers what it last sent and diffs against it. */
class FakeServer {
  private lastSent: WorldState;

  constructor(private readonly sim: SimHandle) {
    this.lastSent = worldState(sim);
  }

  fullState(): WorldState {
    this.lastSent = worldState(this.sim);
    return this.lastSent;
  }

  delta() {
    const next = worldState(this.sim);
    const delta = diffWorldState(this.lastSent, next);
    this.lastSent = next;
    return delta;
  }
}

/** What the network does to a message. */
function overTheWire<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T;
}

function expectSameView(replica: SimHandle, sim: SimHandle): void {
  expect(replica.tick).toBe(sim.tick);
  expect(replica.entityCount).toBe(sim.entityCount);
  expect(getRenderables(replica)).toEqual(getRenderables(sim));
  expect(worldState(replica)).toEqual(worldState(sim));
  for (let slot = 0; slot < 6; slot += 1) {
    const eid = findPlayerEntity(sim, slot);
    expect(findPlayerEntity(replica, slot)).toBe(eid);
    if (eid !== undefined) expect(getHeading(replica, eid)).toEqual(getHeading(sim, eid));
  }
}

async function replicaInSync() {
  const sim = await createSimInternal({ seed: 5 });
  for (let tick = 0; tick < 40; tick += 1) sim.step(script(tick));
  const replica = createReplica({ level: sim.level });
  applyWorldState(replica, worldState(sim));
  expectSameView(replica, sim);
  return { replica, sim };
}

const NOT_UPDATES: unknown[] = [
  undefined,
  null,
  0,
  'full',
  [],
  {},
  { kind: 'full' },
  { kind: 'full', tick: 'now', entities: [] },
  { kind: 'full', tick: -1, entities: [] },
  { kind: 'full', tick: 1.5, entities: [] },
  { kind: 'full', tick: 3, entities: 'none' },
  { kind: 'full', tick: 3, entities: {} },
  { kind: 'delta', tick: 3 },
  { kind: 'delta', fromTick: 2, tick: 3, changed: [] },
  { kind: 'delta', fromTick: 2, tick: 3, changed: {}, removed: [] },
  { kind: 'delta', fromTick: 2, tick: 3, changed: [], removed: 4 },
  { kind: 'delta', fromTick: '2', tick: 3, changed: [], removed: [] },
  { kind: 'snapshot', tick: 3, entities: [] },
  { tick: 3, entities: [] },
];
