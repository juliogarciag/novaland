import { describe, expect, it, vi } from 'vitest';
import { starterLevel } from '../content/levels/starter';
import { MAX_CAPACITY } from '../content/tuning';
import { Replica } from './replica';
import { ensureEntitiesExist } from './restore';
import { applyWorldState } from './worldState';

// bitECS is mocked in this file only, to count allocations: the behaviour itself is tested in restore.test.ts.
const addEntityCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('bitecs', async (importOriginal) => {
  const bitecs = await importOriginal<typeof import('bitecs')>();
  return {
    ...bitecs,
    addEntity: (world: Parameters<typeof bitecs.addEntity>[0]) => {
      addEntityCalls.count += 1;
      return bitecs.addEntity(world);
    },
  };
});

describe('allocation cost of writing a message into a replica', () => {
  it('a shuffled full capacity of new ids costs one pass of at most `capacity` allocations, not ids x capacity', () => {
    // One scan per id would be ids x capacity: minutes at MAX_CAPACITY with ids in a bad order (a server controls the order).
    const capacity = MAX_CAPACITY;
    const world = new Replica({ level: starterLevel, capacity });
    addEntityCalls.count = 0;
    const created = ensureEntitiesExist(world, shuffledIds(capacity));
    expect(created.size).toBe(capacity);
    expect(addEntityCalls.count).toBe(capacity);
  });

  it('a full state with every id in a bad order stays within one pass per message, and so does a delta', () => {
    const capacity = 4096;
    const replica = new Replica({ level: starterLevel, capacity });
    const entities = shuffledIds(capacity).map((id) => ({ id, components: { Position: { x: id, y: 0 } } }));
    addEntityCalls.count = 0;
    expect(applyWorldState(replica, { kind: 'full', tick: 1, entities })).toBe('applied');
    expect(addEntityCalls.count).toBe(capacity);
    expect(replica.entityCount).toBe(capacity);

    // Free every other id, then a delta that re-adds them in the order that recycles each one last.
    const freed = entities.filter((entity) => entity.id % 2 === 0).map((entity) => entity.id);
    applyWorldState(replica, { kind: 'delta', fromTick: 1, tick: 2, changed: [], removed: freed });
    addEntityCalls.count = 0;
    const changed = freed.reverse().map((id) => ({ id, components: { Position: { x: 0, y: id } } }));
    expect(applyWorldState(replica, { kind: 'delta', fromTick: 2, tick: 3, changed, removed: [] })).toBe('applied');
    expect(addEntityCalls.count).toBeLessThanOrEqual(capacity);
    expect(replica.entityCount).toBe(capacity);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

/** 1..capacity in a fixed pseudo-random order (an LCG, so the test is deterministic). */
function shuffledIds(capacity: number): number[] {
  const ids = Array.from({ length: capacity }, (_, index) => index + 1);
  let seed = 3;
  for (let index = ids.length - 1; index > 0; index -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const other = seed % (index + 1);
    [ids[index], ids[other]] = [ids[other] as number, ids[index] as number];
  }
  return ids;
}
