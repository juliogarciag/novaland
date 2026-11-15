/**
 * The world is the same ground as before this ticket: every tile, every
 * collider, the spawn and where a scripted walk takes five players, compared
 * with what baseline/capture-sim.ts recorded on the code before the change.
 * Run by 02-same-ground.mjs, which keeps the report as proof.
 *
 * The baseline is in metres from the old level's top-left corner, and the
 * world's origin is now that same corner, so the numbers compare directly.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldMap } from '../../packages/sim/src/content/world';
import { CHUNK_SIZE, readMapTiles, spawnPoint, tileDefIdAt } from '../../packages/sim/src/content/world/tiles';
import { __testing__ as createTesting } from '../../packages/sim/src/core/create';
import { __testing__ as physicsTesting } from '../../packages/sim/src/core/physics';
import { worldState } from '../../packages/sim/src/core/worldState';
import { getTileDef, TILE_SIZE } from '../../packages/sim/src/features/terrain/defs';
import { scriptedWalk } from './generated-rows.mjs';

const HERE = import.meta.dirname;
const baselineGround = JSON.parse(readFileSync(path.join(HERE, 'baseline/ground.json'), 'utf8')) as {
  columns: number;
  rows: number;
  spawn: { column: number; row: number };
  spawnFromTopLeft: { x: number; y: number };
  defIds: number[][];
  colliders: { column: number; row: number; width: number; height: number }[];
};
const baselineWalk = JSON.parse(readFileSync(path.join(HERE, 'baseline/walk.json'), 'utf8')) as { ticks: number; everyTicks: number; positions: number[][][] };
const report: Record<string, unknown> = {};

describe('the world is the same ground as before', () => {
  it('every tile is the same tile at the same coordinate, and there are no others', () => {
    const tiles = readMapTiles(worldMap);
    expect(tiles.bounds).toEqual({ column: 0, row: 0, width: baselineGround.columns, height: baselineGround.rows });
    let compared = 0;
    for (let row = 0; row < baselineGround.rows; row += 1) {
      for (let column = 0; column < baselineGround.columns; column += 1) {
        expect(tileDefIdAt(tiles, { column, row }), `tile (${column}, ${row})`).toBe(baselineGround.defIds[row]![column]);
        compared += 1;
      }
    }
    const tilesStored = tiles.chunks.reduce((count, chunk) => count + chunk.defIds.filter((defId) => defId !== 0).length, 0);
    expect(tilesStored).toBe(compared);
    report.tiles = { compared, tilesStored, chunks: tiles.chunks.length, chunkSize: CHUNK_SIZE };
  });

  it('the spawn is the same tile and the same point', () => {
    expect(worldMap.spawn).toEqual(baselineGround.spawn);
    expect(spawnPoint(worldMap)).toEqual(baselineGround.spawnFromTopLeft);
    report.spawn = { tile: worldMap.spawn, metres: spawnPoint(worldMap) };
  });

  it('the colliders in the physics world cover exactly the ground the old collider entities covered: every solid tile once, nothing else', async () => {
    const sim = await createTesting.createSimInternal({ seed: 1 });
    const boxes = physicsTesting.staticBoxes(sim);
    const coveredNow = new Map<string, number>();
    for (const box of boxes) {
      const left = (box.x - box.halfWidth) / TILE_SIZE;
      const top = (box.y - box.halfHeight) / TILE_SIZE;
      const width = (2 * box.halfWidth) / TILE_SIZE;
      const height = (2 * box.halfHeight) / TILE_SIZE;
      for (const value of [left, top, width, height]) expect(Number.isInteger(value), JSON.stringify(box)).toBe(true);
      for (let row = top; row < top + height; row += 1) {
        for (let column = left; column < left + width; column += 1) coveredNow.set(`${column},${row}`, (coveredNow.get(`${column},${row}`) ?? 0) + 1);
      }
    }
    const coveredBefore = new Set<string>();
    for (const { column, row, width, height } of baselineGround.colliders) {
      for (let tileRow = row; tileRow < row + height; tileRow += 1) {
        for (let tileColumn = column; tileColumn < column + width; tileColumn += 1) coveredBefore.add(`${tileColumn},${tileRow}`);
      }
    }
    expect([...coveredNow.values()].every((times) => times === 1)).toBe(true);
    expect(new Set(coveredNow.keys())).toEqual(coveredBefore);
    const solidTiles = baselineGround.defIds.flat().filter((defId) => getTileDef(defId).solid).length;
    expect(coveredNow.size).toBe(solidTiles);
    // And they are no longer entities: nothing of the terrain is in a snapshot's entities or in world state.
    expect(sim.entityCount).toBe(0);
    expect(worldState(sim).entities).toEqual([]);
    report.colliders = { boxesNow: boxes.length, collidersBefore: baselineGround.colliders.length, solidTilesCovered: coveredNow.size, solidTiles, terrainEntitiesNow: sim.entityCount };
    sim.destroy();
  });

  it('the same commands walk five players to the same places, trees and rocks included', async () => {
    const sim = await createTesting.createSimInternal({ seed: 1 });
    const walk = scriptedWalk();
    let sample = 0;
    let worstMetres = 0;
    let blockedSamples = 0;
    for (let tick = 0; tick < baselineWalk.ticks; tick += 1) {
      sim.step(walk.commandsAt(tick));
      if (tick % baselineWalk.everyTicks !== baselineWalk.everyTicks - 1) continue;
      const before = baselineWalk.positions[sample]!;
      const now = sim
        .snapshot()
        .entities.filter((entity) => entity.components['Player'])
        .sort((a, b) => a.components['Player']!['slot']! - b.components['Player']!['slot']!)
        .map((entity) => [entity.components['Position']!['x']!, entity.components['Position']!['y']!]);
      expect(now).toHaveLength(before.length);
      now.forEach(([x, y], player) => {
        worstMetres = Math.max(worstMetres, Math.hypot(x! - before[player]![0]!, y! - before[player]![1]!));
        // Pressed against something solid: within half a tile of a solid tile's face.
        const nearSolid = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const defId = tileDefIdAt(readMapTiles(worldMap), { column: Math.floor(x! + dx! * 0.45), row: Math.floor(y! + dy! * 0.45) });
          return defId !== undefined && getTileDef(defId).solid;
        });
        if (nearSolid) blockedSamples += 1;
      });
      sample += 1;
    }
    expect(sample).toBe(baselineWalk.positions.length);
    // The walk does bump into things, or it would prove nothing about collisions.
    expect(blockedSamples).toBeGreaterThan(50);
    /*
     * Not bit for bit, and it cannot be: Rapier keeps positions as 32-bit floats, and the same place is now
     * (x + 20, y + 15) metres from the origin instead of (x, y), so each step rounds differently in the last
     * bits. After 40 seconds of walking and colliding the two runs are within a centimetre: a sixth of a pixel.
     */
    expect(worstMetres).toBeLessThan(0.01);
    report.walk = { ticks: baselineWalk.ticks, samples: sample, players: 5, samplesPressedAgainstSolidTiles: blockedSamples, worstDifferenceMetres: worstMetres, toleranceMetres: 0.01 };
    sim.destroy();
  });

  it('writes the report', () => {
    mkdirSync(path.join(HERE, 'proof'), { recursive: true });
    writeFileSync(path.join(HERE, 'proof/02-same-ground.json'), JSON.stringify(report, null, 2) + '\n');
    expect(Object.keys(report)).toEqual(['tiles', 'spawn', 'colliders', 'walk']);
  });
});
