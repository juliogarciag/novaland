import { beforeAll, describe, expect, it } from 'vitest';
import { DefId, getDef } from '../../content/defs';
import { readTileGrid, spawnPoint, tileCentre } from '../../content/levels/grid';
import { starterLevel } from '../../content/levels/starter';
import { MAX_PLAYER_SLOTS } from '../../content/tuning';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { getTileDef } from '../terrain/defs';
import { findPlayerEntity } from './queries';

describe('player movement (headless)', () => {
  it('spawns a player at the level spawn point on join', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    expect(findPlayerEntity(sim, 0)).toBeDefined();
    expect(playerPosition(sim)).toEqual(SPAWN);
    sim.destroy();
  });

  it('moves at the def speed for N ticks in open space', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    const ticks = 60;
    sim.step([move(1, 0)]);
    for (let i = 1; i < ticks; i += 1) sim.step();
    const { x, y } = playerPosition(sim);
    expect(x).toBeCloseTo(SPAWN.x + SPEED * ticks * sim.dt, 3);
    expect(y).toBeCloseTo(SPAWN.y, 6);
    expect(sim.tick).toBe(ticks + 1);
    sim.destroy();
  });

  it('keeps moving with the last intent and stops on a zero move', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(0, -1)]);
    for (let i = 0; i < 30; i += 1) sim.step();
    const moving = playerPosition(sim);
    expect(moving.y).toBeLessThan(SPAWN.y);
    sim.step([move(0, 0)]);
    for (let i = 0; i < 30; i += 1) sim.step();
    expect(playerPosition(sim)).toEqual(moving);
    sim.destroy();
  });

  it('normalises diagonal and oversized move vectors to the def speed', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(10, 10)]);
    for (let i = 0; i < 59; i += 1) sim.step();
    const { x, y } = playerPosition(sim);
    const travelled = Math.hypot(x - SPAWN.x, y - SPAWN.y);
    expect(travelled).toBeCloseTo(SPEED * 60 * sim.dt, 3);
    expect(x - SPAWN.x).toBeCloseTo(y - SPAWN.y, 5);
    sim.destroy();
  });

  it('treats absurdly large components as full input, not as a stop', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(1.7e308, 0)]);
    for (let i = 0; i < 9; i += 1) sim.step();
    expect(playerPosition(sim).x).toBeCloseTo(SPAWN.x + SPEED * 10 * sim.dt, 3);
    sim.destroy();
  });

  it('is stopped by the forest border (Rapier collision), then slides along it', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    const stopX = firstTreeFaceEastOfSpawn() - RADIUS;

    sim.step([move(1, 0)]);
    for (let i = 0; i < 600; i += 1) sim.step();
    const blocked = playerPosition(sim);
    expect(blocked.x).toBeLessThanOrEqual(stopX + 0.01);
    expect(blocked.x).toBeGreaterThan(stopX - 0.2);

    // Pushing into the wall diagonally still moves along it.
    sim.step([move(1, 1)]);
    for (let i = 0; i < 60; i += 1) sim.step();
    const slid = playerPosition(sim);
    expect(slid.y).toBeGreaterThan(blocked.y + 1);
    expect(slid.x).toBeLessThanOrEqual(stopX + 0.01);
    sim.destroy();
  });

  it('ignores commands for empty or invalid slots and duplicate joins', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([move(1, 0, 3)]);
    sim.step([join(0), join(0)]);
    sim.step([join(-1), join(1.5), join(Number.NaN), join(MAX_PLAYER_SLOTS)]);
    sim.step([{ type: 'player/leave', slot: 7 }, { type: 'player/leave', slot: -3 }]);
    const players = getRenderables(sim).filter((r) => r.defId === DefId.Player);
    expect(players).toHaveLength(1);
    sim.step([move(Number.NaN, Number.POSITIVE_INFINITY)]);
    for (let i = 0; i < 10; i += 1) sim.step();
    expect(playerPosition(sim)).toEqual(SPAWN);
    sim.destroy();
  });

  it('drops malformed command values instead of throwing (the network will send garbage)', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const garbage = [null, undefined, 42, 'player/join', { type: 7 }, { type: 'nope' }, { type: 'player/move' }, JSON.parse('{"type":"player/join","__proto__":{"slot":0}}')] as unknown as Command[];
    expect(() => sim.step(garbage)).not.toThrow();
    expect(getRenderables(sim).filter((r) => r.defId === DefId.Player)).toHaveLength(0);
    expect(sim.tick).toBe(1);
    expect(() => sim.step(null as unknown as Command[])).toThrow(TypeError);
    expect(sim.tick).toBe(1);
    sim.destroy();
  });

  it('removes the player and its body on leave, and a re-join starts fresh at spawn', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    const first = findPlayerEntity(sim, 0);
    const bodiesBefore = sim.physics.bodies.len();
    sim.step([move(1, 0)]);
    for (let i = 0; i < 30; i += 1) sim.step();
    sim.step([{ type: 'player/leave', slot: 0 }]);
    expect(findPlayerEntity(sim, 0)).toBeUndefined();
    expect(sim.physics.bodies.len()).toBe(bodiesBefore - 1);
    expect(getRenderables(sim).filter((r) => r.defId === DefId.Player)).toHaveLength(0);

    sim.step([join()]);
    const second = findPlayerEntity(sim, 0);
    expect(second).toBe(first); // bitECS recycles ids: every field must have been reset
    expect(playerPosition(sim)).toEqual(SPAWN);
    for (let i = 0; i < 10; i += 1) sim.step();
    expect(playerPosition(sim)).toEqual(SPAWN);
    sim.destroy();
  });

  it('ignores a join when the sim is full instead of throwing', async () => {
    const terrainOnly = await createSimInternal({ seed: 1 });
    const capacity = terrainOnly.entityCount + 1;
    terrainOnly.destroy();
    const sim = await createSimInternal({ seed: 1, capacity });
    sim.step([join(0)]);
    expect(sim.entityCount).toBe(capacity);
    expect(() => sim.step([join(1)])).not.toThrow();
    expect(findPlayerEntity(sim, 1)).toBeUndefined();
    expect(() => sim.createEntity()).toThrow(/Sim is full/);
    expect(sim.entityCount).toBe(capacity);
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;

const playerDef = getDef(DefId.Player);
const SPEED = playerDef.speed ?? 0;
const RADIUS = playerDef.radius ?? 0;
const SPAWN = spawnPoint(starterLevel);

beforeAll(() => {
  if (!(SPEED > 0) || !(RADIUS > 0)) throw new Error('the player def must define a positive speed and radius');
});

const join = (slot = 0): Command => ({ type: 'player/join', slot });
const move = (x: number, y: number, slot = 0): Command => ({ type: 'player/move', slot, x, y });

/** West edge, in metres, of the first solid tile east of the spawn on its row. */
function firstTreeFaceEastOfSpawn(): number {
  const grid = readTileGrid(starterLevel);
  const row = grid.defIds[starterLevel.spawn.row] as readonly number[];
  let column = starterLevel.spawn.column;
  while (column < grid.columns && !getTileDef(row[column] as number).solid) column += 1;
  if (column === grid.columns) throw new Error('the starter level has no tree east of the spawn');
  return tileCentre(grid, { column, row: starterLevel.spawn.row }).x - grid.tileSize / 2;
}

function playerPosition(sim: Sim, slot = 0) {
  const eid = findPlayerEntity(sim, slot);
  const r = getRenderables(sim).find((x) => x.eid === eid);
  if (!r) throw new Error('player not rendered');
  return { x: r.x, y: r.y };
}
