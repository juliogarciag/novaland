import { describe, expect, it } from 'vitest';
import { findPlayerEntity } from '../features/player/queries';
import type { Command } from './commands';
import { createReplica, createSim } from './create';
import { applyWorldState } from './replica';
import { applyWorldStateDelta, diffWorldState, worldState, type WorldState, type WorldStateDelta } from './worldState';

describe('worldState', () => {
  it('is the entities of the snapshot plus the tick, with no physics and no rng', async () => {
    const sim = await createSim({ seed: 2 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    const state = worldState(sim);
    const snapshot = sim.snapshot();
    expect(state).toEqual({ kind: 'full', tick: 2, entities: snapshot.entities });
    expect(Object.keys(state).sort()).toEqual(['entities', 'kind', 'tick']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    sim.destroy();
  });
});

describe('diffWorldState and applyWorldStateDelta', () => {
  it('a delta between two states of a running sim rebuilds the later state exactly, through JSON', async () => {
    const sim = await createSim({ seed: 2 });
    let previous = worldState(sim);
    for (let tick = 0; tick < 200; tick += 1) {
      sim.step(script(tick));
      if (tick % 4 !== 0) continue;
      const next = worldState(sim);
      const delta = JSON.parse(JSON.stringify(diffWorldState(previous, next))) as WorldStateDelta;
      expect(delta.fromTick).toBe(previous.tick);
      expect(delta.tick).toBe(next.tick);
      const rebuilt = applyWorldStateDelta(previous, delta);
      expect(rebuilt).toEqual(next);
      expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(next));
      previous = next;
    }
    sim.destroy();
  });

  it('the delta of identical states is empty', () => {
    const state = stateAt(5, [entity(1, { Position: { x: 1, y: 2 } }), entity(2, { DefRef: { id: 3 } })]);
    expect(diffWorldState(state, { ...state, tick: 6 })).toEqual({ kind: 'delta', fromTick: 5, tick: 6, changed: [], removed: [] });
  });

  it('carries only changed components, whole, plus added entities, removed entities and lost components', () => {
    const previous = stateAt(5, [
      entity(1, { Facing: { x: 0, y: 1 }, Position: { x: 1, y: 2 } }),
      entity(2, { DefRef: { id: 3 }, Extents: { halfHeight: 1, halfWidth: 1 } }),
      entity(3, { Position: { x: 0, y: 0 } }),
    ]);
    const next = stateAt(9, [
      entity(1, { Facing: { x: 0, y: 1 }, Position: { x: 1.5, y: 2 } }),
      entity(2, { DefRef: { id: 3 } }),
      entity(4, { Position: { x: 7, y: 7 } }),
    ]);
    const delta = diffWorldState(previous, next);
    expect(delta).toEqual({
      kind: 'delta',
      fromTick: 5,
      tick: 9,
      changed: [
        { id: 1, components: { Position: { x: 1.5, y: 2 } } },
        { id: 2, components: {}, removedComponents: ['Extents'] },
        { id: 4, components: { Position: { x: 7, y: 7 } } },
      ],
      removed: [3],
    });
    expect(applyWorldStateDelta(previous, delta)).toEqual(next);
  });

  it('keeps components and fields in name order, so two routes to the same state serialise the same', () => {
    const state = stateAt(5, [entity(1, { Position: { x: 1, y: 2 } })]);
    const next = applyWorldStateDelta(state, { kind: 'delta', fromTick: 5, tick: 6, changed: [{ id: 1, components: { Facing: { y: 1, x: 0 } } }], removed: [] });
    expect(JSON.stringify(next)).toBe(JSON.stringify(stateAt(6, [entity(1, { Facing: { x: 0, y: 1 }, Position: { x: 1, y: 2 } })])));
  });

  it('does not touch the state it is given', () => {
    const previous = stateAt(1, [entity(1, { Position: { x: 1, y: 2 } })]);
    const copy = JSON.parse(JSON.stringify(previous));
    applyWorldStateDelta(previous, { kind: 'delta', fromTick: 1, tick: 2, changed: [{ id: 1, components: { Position: { x: 9, y: 9 } } }], removed: [] });
    expect(previous).toEqual(copy);
  });

  it('returns undefined for a delta that does not continue from the state or is not a delta', () => {
    const state = stateAt(5, [entity(1, { Position: { x: 1, y: 2 } })]);
    const empty = { changed: [], removed: [] };
    expect(applyWorldStateDelta(state, { kind: 'delta', fromTick: 4, tick: 6, ...empty })).toBeUndefined();
    expect(applyWorldStateDelta(state, { kind: 'delta', fromTick: 6, tick: 7, ...empty })).toBeUndefined();
    expect(applyWorldStateDelta(state, { kind: 'delta', fromTick: 5, tick: 4, ...empty })).toBeUndefined();
    expect(applyWorldStateDelta(state, { kind: 'full', tick: 6, entities: [] } as unknown as WorldStateDelta)).toBeUndefined();
    expect(applyWorldStateDelta(state, null as unknown as WorldStateDelta)).toBeUndefined();
    expect(applyWorldStateDelta(state, { kind: 'delta', fromTick: 5, tick: 6, ...empty })).toEqual({ ...state, tick: 6 });
  });

  it('returns undefined for a state that is not a world state, instead of throwing', () => {
    const delta: WorldStateDelta = { kind: 'delta', fromTick: 0, tick: 1, changed: [], removed: [] };
    for (const state of [null, undefined, 4, 'full', {}, { kind: 'full', tick: 0 }, { kind: 'full', tick: 0, entities: null }, { kind: 'delta', fromTick: 0, tick: 0, changed: [], removed: [] }]) {
      expect(applyWorldStateDelta(state as unknown as WorldState, delta)).toBeUndefined();
    }
    expect(applyWorldStateDelta({ kind: 'full', tick: 0, entities: [null as unknown as WorldState['entities'][number]] }, delta)).toEqual(stateAt(1, []));
  });

  it('validates component names, fields and values exactly like a replica would, so both agree on bad input', async () => {
    const sim = await createSim({ seed: 2 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    const state = worldState(sim);
    const player = findPlayerEntity(sim, 0) as number;
    const delta = {
      kind: 'delta',
      fromTick: state.tick,
      tick: state.tick + 1,
      changed: [
        { id: player, components: { Nonsense: { x: 1 }, Position: { x: 'far', y: 2.5, z: 9 }, MoveIntent: { x: Number.NaN, y: 0.5 } } },
        { id: player + 1, components: { Facing: { y: 1 }, Bogus: {} } },
      ],
      removed: [],
    } as unknown as WorldStateDelta;
    const pure = applyWorldStateDelta(state, delta);
    const replica = createReplica({ level: sim.level });
    applyWorldState(replica, state);
    expect(applyWorldState(replica, delta)).toBe('applied');
    expect(pure).toEqual(worldState(replica));
    const written = pure?.entities.find((entity) => entity.id === player)?.components;
    expect(written?.['Position']).toEqual({ x: state.entities.find((entity) => entity.id === player)?.components['Position']?.['x'], y: 2.5 });
    expect(written?.['MoveIntent']).toEqual({ x: 0, y: 0.5 });
    expect(written?.['Nonsense']).toBeUndefined();
    expect(pure?.entities.find((entity) => entity.id === player + 1)?.components).toEqual({ Facing: { x: 0, y: 1 } });
    sim.destroy();
  });

  it('skips malformed entries of a delta and keeps the rest', () => {
    const state = stateAt(5, [entity(1, { Position: { x: 1, y: 2 } }), entity(2, { Position: { x: 3, y: 4 } })]);
    const delta = {
      kind: 'delta',
      fromTick: 5,
      tick: 6,
      changed: [null, { id: 'x' }, { id: 2, components: { Position: { x: 5, y: 6 } }, removedComponents: [1, 'Facing'] }],
      removed: [1, 'two', -1],
    } as unknown as WorldStateDelta;
    expect(applyWorldStateDelta(state, delta)).toEqual(stateAt(6, [entity(2, { Position: { x: 5, y: 6 } })]));
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

function script(tick: number): Command[] {
  switch (tick) {
    case 0:
      return [{ type: 'player/join', slot: 0 }, { type: 'player/join', slot: 1 }];
    case 1:
      return [{ type: 'player/move', slot: 0, x: 1, y: 0 }, { type: 'player/move', slot: 1, x: -0.3, y: 0.7 }];
    case 80:
      return [{ type: 'player/leave', slot: 1 }];
    case 100:
      return [{ type: 'player/join', slot: 2 }, { type: 'player/move', slot: 2, x: 0, y: 1 }];
    default:
      return [];
  }
}

function stateAt(tick: number, entities: WorldState['entities']): WorldState {
  return { kind: 'full', tick, entities };
}

function entity(id: number, components: Record<string, Record<string, number>>) {
  return { id, components };
}
