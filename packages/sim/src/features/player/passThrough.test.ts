import { describe, expect, it } from 'vitest';
import { readTileGrid, tileCentre } from '../../content/levels/grid';
import type { LevelData } from '../../content/levels/types';
import type { Command } from '../../core/commands';
import { __testing__ as createTesting } from '../../core/create';
import { getBody } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { TerrainDefId } from '../terrain/defs';
import { __testing__ as playerTesting } from './index';
import { findPlayerEntity } from './queries';

describe('players pass through each other (headless)', () => {
  it('two players walking at each other cross and each keeps walking at full speed', async () => {
    const sim = await createSimInternal({ seed: 1, level: hall });
    sim.step([join(0), join(1)]);
    const { west, east } = westAndEast(sim);
    const ticks = 24; // two metres each: well past the other, well short of the hall's ends
    sim.step([move(1, 0, west.slot), move(-1, 0, east.slot)]);
    for (let tick = 1; tick < ticks; tick += 1) sim.step();
    const westNow = playerPosition(sim, west.slot);
    const eastNow = playerPosition(sim, east.slot);
    const travelled = SPEED * ticks * sim.dt;
    expect(westNow.x).toBeCloseTo(west.x + travelled, 3);
    expect(eastNow.x).toBeCloseTo(east.x - travelled, 3);
    expect(westNow.x).toBeGreaterThan(eastNow.x); // they swapped sides
    expect(westNow.y).toBeCloseTo(west.y, 6);
    expect(eastNow.y).toBeCloseTo(east.y, 6);
    sim.destroy();
  });

  it('a standing player does not block a corridor: the other walks straight through and is stopped by the trees beyond', async () => {
    const sim = await createSimInternal({ seed: 1, level: hall });
    const grid = readTileGrid(hall);
    sim.step([join(0), join(1)]);
    const { west, east } = westAndEast(sim);
    // The west player walks east, through the east player, to the hall's east wall.
    const wall = tileCentre(grid, { column: HALL_LAST_FREE_COLUMN + 1, row: HALL_ROW }).x - grid.tileSize / 2;
    sim.step([move(1, 0, west.slot)]);
    for (let tick = 0; tick < 240; tick += 1) sim.step();
    const stopped = playerPosition(sim, west.slot);
    const standing = playerPosition(sim, east.slot);
    expect(stopped.x).toBeGreaterThan(standing.x);
    expect(stopped.x).toBeLessThanOrEqual(wall - RADIUS + 0.01);
    expect(stopped.x).toBeGreaterThan(wall - RADIUS - 0.2);
    expect(standing).toEqual({ x: east.x, y: east.y }); // never pushed
    sim.destroy();
  });

  it('gives every player collider the player layer and a filter that leaves that layer out, so terrain (every layer) still hits', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0), join(1)]);
    for (const slot of [0, 1]) {
      const rigidBody = getBody(sim, findPlayerEntity(sim, slot) as number);
      expect(rigidBody?.numColliders()).toBe(1);
      expect(rigidBody?.collider(0).collisionGroups()).toBe(PLAYER_COLLISION_GROUPS);
    }
    const membership = PLAYER_COLLISION_GROUPS >>> 16;
    const filter = PLAYER_COLLISION_GROUPS & 0xffff;
    expect(membership).not.toBe(0);
    expect(membership & filter).toBe(0);
    expect(filter | membership).toBe(0xffff);
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = createTesting;
const { PLAYER_COLLISION_GROUPS } = playerTesting;

const SPEED = 5;
const RADIUS = 0.4;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, '=': TerrainDefId.Dirt, o: TerrainDefId.Rock };

/** A one-tile-high hall, nine tiles long, with the spawn in the middle: the second join lands on either side of it. */
const HALL_ROW = 2;
const HALL_LAST_FREE_COLUMN = 10;
const hall: LevelData = {
  name: 'hall',
  legend,
  rows: ['TTTTTTTTTTTTT', 'TTTTTTTTTTTTT', 'TT.........TT', 'TTTTTTTTTTTTT', 'TTTTTTTTTTTTT'],
  spawn: { column: 6, row: HALL_ROW },
};

const join = (slot: number): Command => ({ type: 'player/join', slot });
const move = (x: number, y: number, slot: number): Command => ({ type: 'player/move', slot, x, y });

function playerPosition(sim: Sim, slot: number): { x: number; y: number } {
  const eid = findPlayerEntity(sim, slot);
  const renderable = getRenderables(sim).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`player in slot ${slot} not rendered`);
  return { x: renderable.x, y: renderable.y };
}

/** Slots 0 and 1 sorted by x, with their positions: the second join may land on either side of the spawn. */
function westAndEast(sim: Sim) {
  const players = [0, 1].map((slot) => ({ slot, ...playerPosition(sim, slot) })).sort((a, b) => a.x - b.x);
  const [west, east] = players as [(typeof players)[number], (typeof players)[number]];
  expect(east.x - west.x).toBeCloseTo(readTileGrid(hall).tileSize, 6);
  expect(west.y).toBe(east.y);
  return { west, east };
}
