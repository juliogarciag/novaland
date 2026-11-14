/**
 * The ticket's cost table on the new code, measured the way
 * baseline/capture-sim.ts measured the old one: a 40x30 and a 400x300 map
 * made by the same rule, five players walking the same scripted walk, and
 * at every "send" what the room does (build the world state, diff it from
 * the last one sent). The send is timed by itself here; the baseline timed
 * the loop and took the stepping out, which is the same quantity with more
 * noise, and its numbers are milliseconds where these are hundredths.
 * Run by 03-measure.mjs through tsx; prints one JSON array.
 */
import { createPrediction, createSim, diffWorldState, generatedWorldMap, hashSnapshot, readMapTiles, worldState } from '../../packages/sim/src/index';
import { generatedRows, generatedSpawn, scriptedWalk } from './generated-rows.mjs';

const measurements = [];
for (const size of [{ columns: 40, rows: 30 }, { columns: 400, rows: 300 }]) {
  const map = generatedWorldMap(size);
  // The same ground the baseline was measured on.
  const rows = generatedRows(size);
  const sameGround = JSON.stringify(map.areas[0]?.rows) === JSON.stringify(rows) && JSON.stringify(map.spawn) === JSON.stringify(generatedSpawn(rows));
  // No capacity given: the default must do, whatever the map's size.
  const sim = await createSim({ seed: 1, map });
  const walk = scriptedWalk();
  let tick = 0;
  const advance = (ticks: number): void => {
    for (let index = 0; index < ticks; index += 1, tick += 1) sim.step(walk.commandsAt(tick));
  };
  advance(60);
  let previous = worldState(sim);
  const SENDS = 600;
  let deltaBytes = 0;
  let sendMs = 0;
  let stepMs = 0;
  for (let send = 0; send < SENDS; send += 1) {
    const stepStart = performance.now();
    advance(3);
    const sendStart = performance.now();
    const next = worldState(sim);
    const delta = diffWorldState(previous, next);
    const sendEnd = performance.now();
    stepMs += sendStart - stepStart;
    sendMs += sendEnd - sendStart;
    deltaBytes += JSON.stringify(delta).length;
    previous = next;
  }
  const snapshotStart = performance.now();
  for (let index = 0; index < 10; index += 1) hashSnapshot(sim.snapshot());
  const snapshotAndHashMs = (performance.now() - snapshotStart) / 10;
  const state = worldState(sim);
  const prediction = await createPrediction({ map });
  measurements.push({
    ...size,
    sameGroundAsBaseline: sameGround,
    chunks: readMapTiles(map).chunks.length,
    capacity: sim.capacity,
    simEntities: sim.entityCount,
    worldStateEntities: state.entities.length,
    predictionEntitiesBeforeAdopting: prediction.entityCount,
    perSendMs: Number((sendMs / SENDS).toFixed(4)),
    stepMs: Number((stepMs / (3 * SENDS)).toFixed(4)),
    deltaBytesPerSend: Math.round(deltaBytes / SENDS),
    fullStateBytes: JSON.stringify(state).length,
    snapshotAndHashMs: Number(snapshotAndHashMs.toFixed(2)),
  });
  sim.destroy();
  prediction.destroy();
}
console.log(JSON.stringify(measurements));
