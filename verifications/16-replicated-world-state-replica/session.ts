/**
 * The whole contract, end to end, with nothing but the sim's public API: an
 * authoritative sim with five scripted players (the room's maximum) runs for
 * 20 simulated seconds; a "server" sends a full state on join and then
 * deltas at DEFAULT_SEND_RATE, as JSON strings; a "client" parses them into a
 * replica and reads it with the same view queries a browser uses. Every send
 * is compared, a dropped message exercises the resync path, and a pile of
 * malformed messages goes through the replica without ever throwing.
 *
 * Prints one JSON line with the measurements; 02-replica-session.mjs checks it.
 */
import {
  applyWorldState,
  createReplica,
  createSim,
  DEFAULT_SEND_RATE,
  diffWorldState,
  findLevel,
  findPlayerEntity,
  getHeading,
  getRenderables,
  TICK_RATE,
  worldState,
  type Command,
  type SimHandle,
  type WelcomeMessage,
  type WorldState,
  type WorldStateUpdate,
} from '../../packages/sim/src/index.ts';

const SECONDS = 20;
const TICKS = SECONDS * TICK_RATE;
const TICKS_PER_SEND = TICK_RATE / DEFAULT_SEND_RATE;
const SEATS = 5;

const sim = await createSim({ seed: 2026 });
const replica = createReplica({ level: sim.level, capacity: sim.capacity });

// The server keeps the last state it sent to this client and diffs against it.
let lastSent: WorldState = worldState(sim);
const welcome = JSON.stringify({ slot: 0, level: sim.level.name, capacity: sim.capacity, state: lastSent } satisfies WelcomeMessage);
const welcomeMessage = JSON.parse(welcome) as WelcomeMessage;
const welcomeLevel = findLevel(welcomeMessage.level);
const welcomeResult = welcomeLevel === sim.level ? applyWorldState(replica, welcomeMessage.state) : 'unknown level';

const deltaBytes: number[] = [];
let mismatches = 0;
let sends = 0;
let firstMismatch: unknown = null;
let joins = 0;
let leaves = 0;

for (let tick = 0; tick < TICKS; tick += 1) {
  const commands = script(tick);
  joins += commands.filter((command) => command.type === 'player/join').length;
  leaves += commands.filter((command) => command.type === 'player/leave').length;
  sim.step(commands);
  if (tick % TICKS_PER_SEND !== 0) continue;
  const next = worldState(sim);
  const wire = JSON.stringify(diffWorldState(lastSent, next));
  lastSent = next;
  deltaBytes.push(wire.length);
  sends += 1;
  const result = applyWorldState(replica, JSON.parse(wire) as WorldStateUpdate);
  const difference = compareViews(replica, sim);
  if (result !== 'applied' || difference) {
    mismatches += 1;
    firstMismatch ??= { tick, result, difference };
  }
}
const playersAtEnd = Array.from({ length: SEATS }, (_, slot) => findPlayerEntity(sim, slot)).filter((eid) => eid !== undefined).length;
const fullStateBytes = JSON.stringify(worldState(sim)).length;

// Resync: drop a delta, the next one is out of sequence, a full state (what world/resync returns) recovers.
sim.step([{ type: 'player/move', slot: 0, x: -1, y: 0 }]);
const afterFirstStep = worldState(sim);
const dropped = diffWorldState(lastSent, afterFirstStep);
sim.step();
const afterDrop = diffWorldState(afterFirstStep, worldState(sim));
const beforeOutOfSequence = JSON.stringify(worldState(replica));
const outOfSequence = applyWorldState(replica, JSON.parse(JSON.stringify(afterDrop)) as WorldStateUpdate);
const untouchedAfterOutOfSequence = replica.tick === dropped.fromTick && JSON.stringify(worldState(replica)) === beforeOutOfSequence;
const resynced = applyWorldState(replica, JSON.parse(JSON.stringify(worldState(sim))) as WorldStateUpdate);
const sameAfterResync = compareViews(replica, sim) === null;

// Hostile input: nothing here may throw, and the replica must still equal the sim afterwards (or be told to resync).
const player = findPlayerEntity(sim, 0) as number;
const hostile: unknown[] = [
  null, 1, 'x', [], {}, { kind: 'full' }, { kind: 'full', tick: 1, entities: 'no' }, { kind: 'delta', fromTick: 'a', tick: 1, changed: [], removed: [] },
  { kind: 'delta', fromTick: replica.tick, tick: replica.tick + 1, changed: [{ id: 0 }, { id: 1e12, components: {} }, { id: player, components: { Nonsense: { x: 1 }, Position: { x: 'far', y: Infinity } } }], removed: ['x', -1] },
  { kind: 'delta', fromTick: replica.tick + 1, tick: replica.tick + 2, changed: [{ id: player, components: { DefRef: { id: 999999 } } }], removed: [] },
  { kind: 'full', tick: 3, entities: [{ id: player, components: { DefRef: { id: 999999 }, Position: { x: 0, y: 0 } } }, 7, { id: 'a' }] },
];
let hostileThrows = 0;
const hostileResults: string[] = [];
for (const message of hostile) {
  try {
    hostileResults.push(applyWorldState(replica, message as WorldStateUpdate));
    getRenderables(replica);
    getHeading(replica, player);
    findPlayerEntity(replica, 0);
  } catch (error) {
    hostileThrows += 1;
    hostileResults.push(`threw: ${String(error)}`);
  }
}
const drawnAfterHostile = getRenderables(replica).length;
const recoveryResult = applyWorldState(replica, JSON.parse(JSON.stringify(worldState(sim))) as WorldStateUpdate);
const recoveryDifference = compareViews(replica, sim);
const recoveredAfterHostile = recoveryResult === 'applied' && recoveryDifference === null;

let stepThrew = false;
try {
  replica.step();
} catch {
  stepThrew = true;
}

console.log(
  JSON.stringify({
    ticks: TICKS,
    tickRate: TICK_RATE,
    sendRate: DEFAULT_SEND_RATE,
    seats: SEATS,
    joins,
    leaves,
    playersAtEnd,
    welcomeBytes: welcome.length,
    welcomeResult,
    sends,
    mismatches,
    firstMismatch,
    fullStateBytes,
    deltaBytes: { min: Math.min(...deltaBytes), max: Math.max(...deltaBytes), mean: Math.round(deltaBytes.reduce((a, b) => a + b, 0) / deltaBytes.length) },
    entitiesInFullState: worldState(sim).entities.length,
    resync: { outOfSequence, untouchedAfterOutOfSequence, resynced, sameAfterResync },
    hostile: { messages: hostile.length, throws: hostileThrows, results: hostileResults, drawnAfterHostile, recoveredAfterHostile, recoveryResult, recoveryDifference },
    stepThrew,
    replicaSnapshot: { physics: replica.snapshot().physics, rng: replica.snapshot().rng, tick: replica.tick },
  }),
);
sim.destroy();

/** Five players join over the first second, walk in different directions, one leaves and rejoins. */
function script(tick: number): Command[] {
  const commands: Command[] = [];
  for (let slot = 0; slot < SEATS; slot += 1) {
    if (tick === slot * 12) commands.push({ type: 'player/join', slot });
    if (tick === slot * 12 + 1) commands.push({ type: 'player/move', slot, x: Math.cos(slot * 1.3), y: Math.sin(slot * 1.3) });
    if (tick === 300 + slot * 30) commands.push({ type: 'player/move', slot, x: -Math.cos(slot * 0.7), y: Math.sin(slot * 0.7) });
    if (tick === 700 + slot * 10) commands.push({ type: 'player/move', slot, x: 0, y: 0 });
    if (tick === 900 + slot * 7) commands.push({ type: 'player/move', slot, x: Math.sin(slot), y: -Math.cos(slot) });
  }
  if (tick === 500) commands.push({ type: 'player/leave', slot: 2 });
  if (tick === 620) commands.push({ type: 'player/join', slot: 2 }, { type: 'player/move', slot: 2, x: 0, y: 1 });
  return commands;
}

/** What differs between the two views, or null when nothing does. Everything a browser reads goes through these queries. */
function compareViews(a: SimHandle, b: SimHandle): unknown {
  if (a.tick !== b.tick) return { tick: [a.tick, b.tick] };
  if (a.entityCount !== b.entityCount) return { entityCount: [a.entityCount, b.entityCount] };
  const drawnA = JSON.stringify(getRenderables(a));
  const drawnB = JSON.stringify(getRenderables(b));
  if (drawnA !== drawnB) return { renderables: [drawnA, drawnB] };
  const stateA = JSON.stringify(worldState(a));
  const stateB = JSON.stringify(worldState(b));
  if (stateA !== stateB) return { worldState: 'differs' };
  for (let slot = 0; slot < SEATS + 1; slot += 1) {
    const eidA = findPlayerEntity(a, slot);
    const eidB = findPlayerEntity(b, slot);
    if (eidA !== eidB) return { slot, eid: [eidA, eidB] };
    if (eidA !== undefined && JSON.stringify(getHeading(a, eidA)) !== JSON.stringify(getHeading(b, eidA))) return { slot, heading: 'differs' };
  }
  return null;
}
