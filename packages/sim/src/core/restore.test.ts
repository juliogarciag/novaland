import { addEntity, entityExists, getAllEntities, hasComponent, removeEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { starterLevel } from '../content/levels/starter';
import { Facing, MoveIntent } from '../features/player/components';
import { Replica } from './replica';
import { ensureEntityExists, removeEntityComponents, restoreEntity, writeEntityComponents } from './restore';
import { Position } from './transform';

describe('ensureEntityExists', () => {
  it('creates exactly the asked-for id in an empty world, leaving no other entity behind', () => {
    const world = emptyWorld(16);
    expect(ensureEntityExists(world, 5)).toBe(true);
    expect(alive(world)).toEqual([5]);
    expect(ensureEntityExists(world, 2)).toBe(true);
    expect(ensureEntityExists(world, 16)).toBe(true);
    expect(alive(world)).toEqual([2, 5, 16]);
  });

  it('is a no-op for a live id', () => {
    const world = emptyWorld(16);
    ensureEntityExists(world, 3);
    expect(ensureEntityExists(world, 3)).toBe(true);
    expect(alive(world)).toEqual([3]);
  });

  it('brings back a freed id, however the world was used before', () => {
    const world = emptyWorld(16);
    for (let i = 0; i < 10; i += 1) addEntity(world.world);
    removeEntity(world.world, 3);
    removeEntity(world.world, 7);
    removeEntity(world.world, 9);
    expect(ensureEntityExists(world, 7)).toBe(true);
    expect(alive(world)).toEqual([1, 2, 4, 5, 6, 7, 8, 10]);
    expect(ensureEntityExists(world, 12)).toBe(true);
    expect(alive(world)).toEqual([1, 2, 4, 5, 6, 7, 8, 10, 12]);
  });

  it('refuses ids outside 1..capacity and never allocates past the capacity', () => {
    const world = emptyWorld(8);
    for (const id of [0, -1, 1.5, 9, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ensureEntityExists(world, id)).toBe(false);
    }
    expect(alive(world)).toEqual([]);
    ensureEntityExists(world, 8);
    expect(Math.max(...alive(world))).toBe(8);
  });

  it('agrees with a plain model over a long scripted mix of adds, removes and ensures', () => {
    const world = emptyWorld(32);
    const model = new Set<number>();
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let step = 0; step < 2000; step += 1) {
      const id = 1 + (next() % 32);
      const action = next() % 3;
      if (action === 0 && !model.has(id)) {
        expect(ensureEntityExists(world, id)).toBe(true);
        model.add(id);
      } else if (action === 1 && model.has(id)) {
        removeEntity(world.world, id);
        model.delete(id);
      } else if (action === 2) {
        expect(ensureEntityExists(world, id)).toBe(true);
        model.add(id);
      }
      expect(alive(world)).toEqual([...model].sort((a, b) => a - b));
    }
  });
});

describe('writeEntityComponents', () => {
  it('attaches the component and writes every field, zeroing what a fresh component is not given', () => {
    const world = emptyWorld(8);
    ensureEntityExists(world, 4);
    const position = world.store(Position);
    position.x[4] = 99;
    position.y[4] = 99;
    writeEntityComponents(world, 4, { Position: { x: 1.5 } });
    expect(hasComponent(world.world, 4, position)).toBe(true);
    expect([position.x[4], position.y[4]]).toEqual([1.5, 0]);
  });

  it('keeps the fields it is not given once the component is there', () => {
    const world = emptyWorld(8);
    ensureEntityExists(world, 4);
    writeEntityComponents(world, 4, { Position: { x: 1, y: 2 } });
    writeEntityComponents(world, 4, { Position: { y: 5 } });
    const position = world.store(Position);
    expect([position.x[4], position.y[4]]).toEqual([1, 5]);
  });

  it('skips unknown components, unknown fields, non-objects and values that are not finite numbers', () => {
    const world = emptyWorld(8);
    ensureEntityExists(world, 2);
    writeEntityComponents(world, 2, 'nothing');
    writeEntityComponents(world, 2, { Nope: { x: 1 }, Position: 7, Facing: { x: 'left', y: Number.NaN, z: 1 }, MoveIntent: { x: Number.POSITIVE_INFINITY, y: 0.25 } });
    expect(hasComponent(world.world, 2, world.store(Position))).toBe(false);
    const facing = world.store(Facing);
    expect(hasComponent(world.world, 2, facing)).toBe(true);
    expect([facing.x[2], facing.y[2]]).toEqual([0, 0]);
    const intent = world.store(MoveIntent);
    expect([intent.x[2], intent.y[2]]).toEqual([0, 0.25]);
  });
});

describe('removeEntityComponents and restoreEntity', () => {
  it('detaches named components and ignores names that are not there or not components', () => {
    const world = emptyWorld(8);
    ensureEntityExists(world, 1);
    writeEntityComponents(world, 1, { Position: { x: 1, y: 1 }, Facing: { x: 0, y: 1 } });
    removeEntityComponents(world, 1, ['Facing', 'Nope', 3, null, 'MoveIntent']);
    removeEntityComponents(world, 1, 'Position');
    expect(hasComponent(world.world, 1, world.store(Position))).toBe(true);
    expect(hasComponent(world.world, 1, world.store(Facing))).toBe(false);
  });

  it('restoreEntity leaves the entity with exactly the given components', () => {
    const world = emptyWorld(8);
    expect(restoreEntity(world, 6, { Position: { x: 1, y: 1 }, Facing: { x: 0, y: 1 } })).toBe(true);
    expect(restoreEntity(world, 6, { MoveIntent: { x: 1, y: 0 }, Facing: { x: 1, y: 0 } })).toBe(true);
    expect(hasComponent(world.world, 6, world.store(Position))).toBe(false);
    expect(hasComponent(world.world, 6, world.store(MoveIntent))).toBe(true);
    expect(world.store(Facing).x[6]).toBe(1);
    expect(restoreEntity(world, 9, { Position: { x: 1, y: 1 } })).toBe(false);
    expect(entityExists(world.world, 9)).toBe(false);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

/** A replica is the simplest EntityWorld: no features, no physics. */
function emptyWorld(capacity: number): Replica {
  return new Replica({ level: starterLevel, capacity });
}

function alive(world: Replica): number[] {
  return [...getAllEntities(world.world)].sort((a, b) => a - b);
}
