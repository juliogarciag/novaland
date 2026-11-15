import { describe, expect, it } from 'vitest';
import { readMapTiles, spawnPoint, tileAt, tileCentre, tileDefIdAt } from '../../content/world/tiles';
import type { TileCoordinate, WorldMap } from '../../content/world/types';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { hashSnapshot } from '../../core/snapshot';
import { getTileDef, TerrainDefId } from '../terrain/defs';
import { getPlayerPosition } from './queries';

describe('a join that returns a player to where they left (headless)', () => {
  it('puts the player on the point they left, not on the centre of its tile', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    const left = { x: 7.3, y: 2.8 };
    sim.step([join(0, left)]);
    expect(getPlayerPosition(sim, 0)).toEqual(asPhysicsKeepsIt(left));
    sim.destroy();
  });

  it('keeps the player there on the following ticks: the point was a place a body can stand', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    const left = tileCentre({ column: 8, row: 3 });
    sim.step([join(0, left)]);
    for (let tick = 0; tick < 30; tick += 1) sim.step();
    expect(getPlayerPosition(sim, 0)).toEqual(left);
    sim.destroy();
  });

  it('lands on the nearest free tile when the tile they left is solid now', async () => {
    // The player left tile (3, 1), which is a rock in this map. The point is in the tile's east half, so the tile east of it is the nearest.
    const sim = await createSimInternal({ seed: 1, map: mapOf(['.....', '...o.', '.....'], { column: 0, row: 0 }) });
    sim.step([join(0, { x: 3.9, y: 1.5 })]);
    expect(getPlayerPosition(sim, 0)).toEqual(tileCentre({ column: 4, row: 1 }));
    sim.destroy();
  });

  it('picks the nearest free tile by distance to the point, also when it is not in the first ring', async () => {
    // Everything around (3, 1) is trees but for two tiles: (5, 1), two tiles east, and (0, 1), three tiles west.
    const sim = await createSimInternal({ seed: 1, map: mapOf(['TTTTTTT', '.TToT.T', 'TTTTTTT'], { column: 0, row: 1 }) });
    sim.step([join(0, { x: 3.5, y: 1.5 })]);
    expect(playerTile(sim, 0)).toEqual({ column: 5, row: 1 });
    sim.destroy();
  });

  it('lands on the nearest free tile when another player stands on the tile they left', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    const taken = tileCentre({ column: 8, row: 3 });
    sim.step([join(0, taken)]);
    sim.step([join(1, { x: taken.x - 0.1, y: taken.y })]);
    expect(playerTile(sim, 0)).toEqual({ column: 8, row: 3 });
    expect(playerTile(sim, 1)).toEqual({ column: 7, row: 3 });
    sim.destroy();
  });

  it('never counts a player that left in the same step: their tile is free for whoever returns to it', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    const left = { x: 7.3, y: 2.8 };
    sim.step([join(0, left)]);
    sim.step([{ type: 'player/leave', slot: 0 }, join(0, left)]);
    expect(getPlayerPosition(sim, 0)).toEqual(asPhysicsKeepsIt(left));
    sim.destroy();
  });

  it('spawns the player as a new one when no tile within 8 tiles of the point is free', async () => {
    const lonely = mapOf([`.${'T'.repeat(20)}`], { column: 0, row: 0 });
    const sim = await createSimInternal({ seed: 1, map: lonely });
    // Tile (9, 0) is a tree and the only walkable tile, the spawn, is 9 tiles away; from (8, 0) it is 8.
    sim.step([join(0, tileCentre({ column: 9, row: 0 })), join(1, tileCentre({ column: 8, row: 0 }))]);
    expect(getPlayerPosition(sim, 0)).toEqual(spawnPoint(lonely));
    expect(getPlayerPosition(sim, 1)).toEqual(spawnPoint(lonely));
    sim.destroy();
  });

  it('spawns the player as a new one when the point is far outside the map', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    sim.step([join(0, { x: 1e9, y: -1e9 })]);
    expect(getPlayerPosition(sim, 0)).toEqual(spawnPoint(field));
    sim.destroy();
  });

  it('treats a malformed returnTo as none at all: the world ends up exactly as after a plain join', async () => {
    const plain = await createSimInternal({ seed: 7, map: field });
    plain.step([{ type: 'player/join', slot: 0 }]);
    const expected = hashSnapshot(plain.snapshot());
    plain.destroy();
    for (const returnTo of MALFORMED_POINTS) {
      const sim = await createSimInternal({ seed: 7, map: field });
      expect(() => sim.step([{ type: 'player/join', slot: 0, returnTo } as unknown as Command])).not.toThrow();
      expect(hashSnapshot(sim.snapshot()), JSON.stringify(returnTo) ?? String(returnTo)).toBe(expected);
      sim.destroy();
    }
  });

  it('is deterministic: the same seed and the same joins give the same world', async () => {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const sim = await createSimInternal({ seed: 3, map: field });
      sim.step([join(0, { x: 7.3, y: 2.8 }), join(1), join(2, { x: 7.4, y: 2.9 })]);
      for (let tick = 0; tick < 10; tick += 1) sim.step();
      hashes.push(hashSnapshot(sim.snapshot()));
      sim.destroy();
    }
    expect(hashes[1]).toBe(hashes[0]);
  });

  it('fuzzed with 2000 random points, never throws and always leaves the player on a walkable tile', async () => {
    const random = seededRandom(55);
    const sim = await createSimInternal({ seed: 1, map: field });
    const tiles = readMapTiles(field);
    for (let round = 0; round < 2000; round += 1) {
      const returnTo = randomPoint(random);
      expect(() => sim.step([{ type: 'player/join', slot: 0, returnTo } as unknown as Command])).not.toThrow();
      const tile = playerTile(sim, 0);
      const defId = tileDefIdAt(tiles, tile);
      expect(defId !== undefined && !getTileDef(defId).solid, `${JSON.stringify(returnTo)} left the player on ${JSON.stringify(tile)}`).toBe(true);
      sim.step([{ type: 'player/leave', slot: 0 }]);
    }
    sim.destroy();
  });
});

describe('getPlayerPosition', () => {
  it('says where the player in a slot stands and nothing for an empty slot', async () => {
    const sim = await createSimInternal({ seed: 1, map: field });
    sim.step([join(2)]);
    expect(getPlayerPosition(sim, 2)).toEqual(spawnPoint(field));
    expect(getPlayerPosition(sim, 0)).toBeUndefined();
    sim.destroy();
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;

const legend = { T: TerrainDefId.Tree, '.': TerrainDefId.Grass, o: TerrainDefId.Rock };

/** A map of one area whose top-left tile is world tile (0, 0). */
function mapOf(rows: readonly string[], spawn: TileCoordinate): WorldMap {
  return { areas: [{ name: 'test', origin: { column: 0, row: 0 }, legend, rows }], spawn };
}

/** Open grass, 12 by 6 tiles, with a rock in it; the spawn is in the north-west corner. */
const field = mapOf(['............', '............', '.....o......', '............', '............', '............'], { column: 1, row: 1 });

/** Values no server should put in `returnTo`, and that the handler must read as "no point". */
const MALFORMED_POINTS: readonly unknown[] = [null, 'here', 7, true, [], [1, 2], {}, { x: 1 }, { y: 1 }, { x: '1', y: 1 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: null, y: null }];

function join(slot: number, returnTo?: { x: number; y: number }): Command {
  return returnTo ? { type: 'player/join', slot, returnTo } : { type: 'player/join', slot };
}

/** The point as a body holds it: physics keeps positions as 32-bit floats, so a point comes back rounded to one. */
function asPhysicsKeepsIt({ x, y }: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.fround(x), y: Math.fround(y) };
}

function playerTile(sim: Sim, slot: number): TileCoordinate {
  const position = getPlayerPosition(sim, slot);
  const tile = position && tileAt(position.x, position.y);
  if (!tile) throw new Error(`no player in slot ${slot}`);
  return tile;
}

/** A small deterministic generator (mulberry32), so a failing fuzz round can be replayed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random `returnTo`: mostly points in and around the field, some far away, some not points at all. */
function randomPoint(random: () => number): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const coordinate = (): unknown => (random() < 0.8 ? random() * 16 - 2 : pick([NaN, Infinity, -Infinity, 1e308, -1e308, 2 ** 53, -0, null, '3', undefined, {}, []]));
  const roll = random();
  if (roll < 0.85) return { x: coordinate(), y: coordinate() };
  if (roll < 0.9) return { x: coordinate() };
  return pick(MALFORMED_POINTS);
}
