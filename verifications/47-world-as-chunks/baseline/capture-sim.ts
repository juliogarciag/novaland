/**
 * Run once, on the code before this ticket (the commit is named in ../README.md),
 * to record what "exactly as before" means. It cannot run on the new code:
 * it reads levels, `readTileGrid` and `TerrainCollider` entities, which this
 * ticket replaces. Kept as the record of how baseline/*.json were made.
 *
 *   pnpm --filter @novaland/server exec tsx ../../verifications/47-world-as-chunks/baseline/capture-sim.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, diffWorldState, hashSnapshot, readTileGrid, starterLevel, tileCentre, worldState, type LevelData } from '../../../packages/sim/src/index';
import { generatedRows, generatedSpawn, scriptedWalk } from '../generated-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = 202;
const GRASS = 200;
const ROCK = 203;

// ---- The ground: every tile and every collider rectangle of the starter level, in tiles from its top-left corner ----
const grid = readTileGrid(starterLevel);
const sim = await createSim({ seed: 1, level: starterLevel });
const colliders = sim
  .snapshot()
  .entities.filter((entity) => entity.components.TerrainCollider)
  .map((entity) => {
    const { column, row, width, height } = entity.components.TerrainCollider as Record<string, number>;
    const { x, y } = entity.components.Position as Record<string, number>;
    const { halfWidth, halfHeight } = entity.components.Extents as Record<string, number>;
    // The box in metres from the level's top-left corner must be the tile rectangle.
    const left = x - halfWidth + grid.width / 2;
    const top = y - halfHeight + grid.height / 2;
    if (left !== column || top !== row || halfWidth * 2 !== width || halfHeight * 2 !== height) throw new Error('a collider does not cover its tile rectangle');
    return { column, row, width, height };
  });
const spawnCentre = tileCentre(grid, starterLevel.spawn);
writeFileSync(
  path.join(HERE, 'ground.json'),
  JSON.stringify({ columns: grid.columns, rows: grid.rows, spawn: starterLevel.spawn, spawnFromTopLeft: { x: spawnCentre.x + grid.width / 2, y: spawnCentre.y + grid.height / 2 }, defIds: grid.defIds, colliders }, null, 1) + '\n',
);

// ---- The walk: five players pushed around for 40 seconds; where each is every 10 ticks, in metres from the top-left corner ----
const walk = scriptedWalk();
const positions: number[][][] = [];
const WALK_TICKS = 2400;
for (let tick = 0; tick < WALK_TICKS; tick += 1) {
  sim.step(walk.commandsAt(tick));
  if (tick % 10 === 9) {
    positions.push(
      sim
        .snapshot()
        .entities.filter((entity) => entity.components.Player)
        .sort((a, b) => (a.components.Player as Record<string, number>).slot! - (b.components.Player as Record<string, number>).slot!)
        .map((entity) => [(entity.components.Position as Record<string, number>).x! + grid.width / 2, (entity.components.Position as Record<string, number>).y! + grid.height / 2]),
    );
  }
}
writeFileSync(path.join(HERE, 'walk.json'), JSON.stringify({ ticks: WALK_TICKS, everyTicks: 10, positions }) + '\n');

// ---- The cost of terrain as replicated entities: the ticket's table, measured the same way the new code is ----
const measurements = [];
for (const size of [{ columns: 40, rows: 30 }, { columns: 400, rows: 300 }]) {
  const rows = generatedRows(size);
  const level: LevelData = { name: `generated-${size.columns}x${size.rows}`, legend: { T: TREE, '.': GRASS, o: ROCK }, rows, spawn: generatedSpawn(rows) };
  measurements.push({ ...size, ...(await measure(level)) });
}
writeFileSync(path.join(HERE, 'measurements.json'), JSON.stringify(measurements, null, 1) + '\n');
console.log(JSON.stringify(measurements, null, 1));

async function measure(level: LevelData) {
  const measured = await createSim({ seed: 1, level, capacity: 16384 });
  const steps = scriptedWalk();
  let tick = 0;
  const advance = (ticks: number) => {
    for (let index = 0; index < ticks; index += 1, tick += 1) measured.step(steps.commandsAt(tick));
  };
  advance(60);
  // What the room does at every send: build the world state, diff it from the last one sent.
  let previous = worldState(measured);
  const SENDS = 200;
  let deltaBytes = 0;
  const sendStart = performance.now();
  for (let send = 0; send < SENDS; send += 1) {
    advance(3);
    const next = worldState(measured);
    const delta = diffWorldState(previous, next);
    deltaBytes += JSON.stringify(delta).length;
    previous = next;
  }
  // Stepping is inside the loop above; measure it alone and take it out.
  const stepStart = performance.now();
  advance(3 * SENDS);
  const stepMs = performance.now() - stepStart;
  const perSendMs = (performance.now() - sendStart - stepMs - stepMs) / SENDS;
  const snapshotStart = performance.now();
  for (let index = 0; index < 10; index += 1) hashSnapshot(measured.snapshot());
  const snapshotAndHashMs = (performance.now() - snapshotStart) / 10;
  const state = worldState(measured);
  return {
    simEntities: measured.entityCount,
    worldStateEntities: state.entities.length,
    perSendMs: Number(perSendMs.toFixed(3)),
    deltaBytesPerSend: Math.round(deltaBytes / SENDS),
    fullStateBytes: JSON.stringify(state).length,
    snapshotAndHashMs: Number(snapshotAndHashMs.toFixed(2)),
  };
}
