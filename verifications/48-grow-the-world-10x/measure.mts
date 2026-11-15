/**
 * What the world costs to run, on the 40x30 world from before this ticket
 * (baseline/world-before.json) and on the world as it is now, measured the
 * same way in the same process: five players join and are pushed around by
 * the same scripted walk, the sim steps at its fixed tick, and every third
 * tick does what the room does on a send (build the world state, diff it
 * from the last one sent).
 *
 * The two maps are measured in turns, ROUNDS times each, so that whatever
 * else the machine is doing falls on both. Run by 02-measure.mjs through
 * tsx; prints one JSON object on its last line.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createSim, diffWorldState, hashSnapshot, readMapTiles, worldMap, worldState, type Command, type WorldMap } from '../../packages/sim/src/index';

const ROUNDS = 9;
const SENDS = 600;
const TICKS_PER_SEND = 3;
const PLAYERS = 5;

const before = JSON.parse(readFileSync(path.join(import.meta.dirname, 'baseline/world-before.json'), 'utf8')) as { origin: { column: number; row: number }; spawn: { column: number; row: number }; rows: string[] };
const worldBefore: WorldMap = {
  // The clearing's legend has not changed: the same characters are the same tiles.
  areas: [{ name: 'clearing', origin: before.origin, legend: worldMap.areas[0]!.legend, rows: before.rows }],
  spawn: before.spawn,
};
const maps = [
  { name: 'before', map: worldBefore },
  { name: 'now', map: worldMap },
];

// Rapier is loaded by the first sim; nothing measured should pay for that.
(await createSim({ seed: 1 })).destroy();

const rounds: Record<string, Measurement[]> = { before: [], now: [] };
for (let round = 0; round < ROUNDS; round += 1) {
  for (const { name, map } of maps) rounds[name]!.push(await measure(map));
}

const summary = Object.fromEntries(
  maps.map(({ name, map }) => {
    const measured = rounds[name]!;
    const { bounds, chunks } = readMapTiles(map);
    const numbers = (read: (measurement: Measurement) => number): { median: number; lowest: number; highest: number } => {
      const sorted = measured.map(read).sort((first, second) => first - second);
      return { median: sorted[Math.floor(sorted.length / 2)]!, lowest: sorted[0]!, highest: sorted[sorted.length - 1]! };
    };
    return [
      name,
      {
        tiles: bounds.width * bounds.height,
        columns: bounds.width,
        rows: bounds.height,
        chunks: chunks.length,
        simEntities: measured[0]!.simEntities,
        worldStateEntities: measured[0]!.worldStateEntities,
        fullStateBytes: measured[0]!.fullStateBytes,
        deltaBytesPerSend: measured[0]!.deltaBytesPerSend,
        tickMs: numbers((measurement) => measurement.tickMs),
        perSendMs: numbers((measurement) => measurement.perSendMs),
        bootMs: numbers((measurement) => measurement.bootMs),
        snapshotAndHashMs: numbers((measurement) => measurement.snapshotAndHashMs),
      },
    ];
  }),
);
console.log(JSON.stringify({ rounds: ROUNDS, sends: SENDS, ticksPerSend: TICKS_PER_SEND, players: PLAYERS, ...summary }));

// ---- Helpers ----

interface Measurement {
  simEntities: number;
  worldStateEntities: number;
  fullStateBytes: number;
  deltaBytesPerSend: number;
  tickMs: number;
  perSendMs: number;
  bootMs: number;
  snapshotAndHashMs: number;
}

async function measure(map: WorldMap): Promise<Measurement> {
  const bootStart = performance.now();
  const sim = await createSim({ seed: 1, map });
  const bootMs = performance.now() - bootStart;
  const commandsAt = scriptedWalk();
  let tick = 0;
  const advance = (ticks: number): void => {
    for (let index = 0; index < ticks; index += 1, tick += 1) sim.step(commandsAt(tick));
  };
  advance(60);
  let previous = worldState(sim);
  let deltaBytes = 0;
  let sendMs = 0;
  let stepMs = 0;
  for (let send = 0; send < SENDS; send += 1) {
    const stepStart = performance.now();
    advance(TICKS_PER_SEND);
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
  const measurement = {
    simEntities: sim.entityCount,
    worldStateEntities: state.entities.length,
    fullStateBytes: JSON.stringify(state).length,
    deltaBytesPerSend: Math.round(deltaBytes / SENDS),
    tickMs: stepMs / (TICKS_PER_SEND * SENDS),
    perSendMs: sendMs / SENDS,
    bootMs,
    snapshotAndHashMs,
  };
  sim.destroy();
  return measurement;
}

/** Five players who join on the first tick and are each given a new direction, or told to stand, every half second. The same every time. */
function scriptedWalk(): (tick: number) => Command[] {
  let state = 0x9e3779b9;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: 0, y: 0 },
  ];
  return (tick) => {
    if (tick === 0) return Array.from({ length: PLAYERS }, (_, slot) => ({ type: 'player/join', slot }) as Command);
    if (tick % 30 !== 0) return [];
    return Array.from({ length: PLAYERS }, (_, slot) => ({ type: 'player/move', slot, ...directions[Math.floor(next() * directions.length)]! }) as Command);
  };
}
