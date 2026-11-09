import { entityExists, getAllEntities, removeEntity } from 'bitecs';
import { asEntityWorld } from './entityWorld';
import { asReplica } from './replica';
import { ensureEntityExists, isEntityId, removeEntityComponents, restoreEntity, writeEntityComponents } from './restore';
import type { SimHandle } from './sim';
import { snapshotEntities, type EntitySnapshot } from './snapshot';

/**
 * World state is what a server sends to its players: every entity with every
 * component field, plus the tick it was taken at. No physics bytes and no
 * rng, because a replica never steps (ADR 0004). It is plain JSON.
 *
 * Deltas carry only what changed between two world states, component by
 * component, so static things (terrain) travel once and five walking players
 * cost a few hundred bytes per update.
 */
export interface WorldState {
  readonly kind: 'full';
  readonly tick: number;
  /** Sorted by id, like a snapshot's entities. */
  readonly entities: readonly EntitySnapshot[];
}

/** What changed about one entity. A new entity carries all of its components. */
export interface EntityDelta {
  readonly id: number;
  /** Every field of every component that changed or appeared. */
  readonly components: Record<string, Record<string, number>>;
  /** Components the entity lost. Omitted when empty. */
  readonly removedComponents?: readonly string[];
}

export interface WorldStateDelta {
  readonly kind: 'delta';
  /** Tick of the state this delta applies to. A replica at any other tick needs a full state instead. */
  readonly fromTick: number;
  /** Tick of the state this delta produces. */
  readonly tick: number;
  readonly changed: readonly EntityDelta[];
  /** Ids of entities that no longer exist. */
  readonly removed: readonly number[];
}

export type WorldStateUpdate = WorldState | WorldStateDelta;

/**
 * What applying an update to a replica did. `out-of-sequence` means a delta
 * did not continue from the replica's tick (a message was missed or the
 * replica is fresh): the replica is untouched and needs a full state.
 * `malformed` means the update was not a world state or delta at all.
 */
export type WorldStateApplyResult = 'applied' | 'out-of-sequence' | 'malformed';

/** The current world state of a sim or a replica. */
export function worldState(handle: SimHandle): WorldState {
  return { kind: 'full', tick: handle.tick, entities: snapshotEntities(asEntityWorld(handle)) };
}

/** What changed from `previous` to `next`, as a delta that `applyWorldStateDelta` turns back into `next`. */
export function diffWorldState(previous: WorldState, next: WorldState): WorldStateDelta {
  const previousById = new Map(previous.entities.map((entity) => [entity.id, entity]));
  const nextIds = new Set<number>();
  const changed: EntityDelta[] = [];
  for (const entity of next.entities) {
    nextIds.add(entity.id);
    const before = previousById.get(entity.id);
    if (!before) {
      changed.push({ id: entity.id, components: entity.components });
      continue;
    }
    const components: Record<string, Record<string, number>> = {};
    let changedComponents = 0;
    for (const name of Object.keys(entity.components)) {
      const fields = entity.components[name] as Record<string, number>;
      if (!sameFields(before.components[name], fields)) {
        components[name] = fields;
        changedComponents += 1;
      }
    }
    const removedComponents = Object.keys(before.components).filter((name) => !Object.hasOwn(entity.components, name));
    if (changedComponents === 0 && removedComponents.length === 0) continue;
    changed.push(removedComponents.length > 0 ? { id: entity.id, components, removedComponents } : { id: entity.id, components });
  }
  const removed = previous.entities.filter((entity) => !nextIds.has(entity.id)).map((entity) => entity.id);
  return { kind: 'delta', fromTick: previous.tick, tick: next.tick, changed, removed };
}

/**
 * The world state after `delta`, or undefined when `delta` is malformed or
 * does not continue from `state.tick`. Pure: `state` is not changed. Views
 * that keep the last few states for interpolation use this; a replica uses
 * `applyWorldState`.
 */
export function applyWorldStateDelta(state: WorldState, delta: WorldStateDelta): WorldState | undefined {
  const update = readWorldStateUpdate(delta);
  if (!update || update.kind !== 'delta' || update.fromTick !== state.tick) return undefined;
  const byId = new Map(state.entities.map((entity) => [entity.id, entity]));
  for (const id of update.removed) byId.delete(id);
  for (const change of update.changed) {
    const before = byId.get(change.id)?.components ?? {};
    const lost = new Set(change.removedComponents ?? []);
    const merged: Record<string, Record<string, number>> = {};
    for (const name of Object.keys(before)) {
      if (!lost.has(name)) merged[name] = before[name] as Record<string, number>;
    }
    for (const name of Object.keys(change.components)) {
      merged[name] = sortedFields({ ...merged[name], ...change.components[name] });
    }
    byId.set(change.id, { id: change.id, components: sortedComponents(merged) });
  }
  const entities = [...byId.values()].sort((a, b) => a.id - b.id);
  return { kind: 'full', tick: update.tick, entities };
}

/**
 * Writes a world state or delta into a replica. This is where network data
 * enters the sim: the update is checked field by field, and anything that is
 * not a valid entity id, a known component or a finite number is skipped.
 * A full state replaces everything the replica had, whatever its tick (the
 * server may have restarted). A delta applies only when it continues from
 * the replica's tick.
 */
export function applyWorldState(handle: SimHandle, update: WorldStateUpdate): WorldStateApplyResult {
  const replica = asReplica(handle);
  const read = readWorldStateUpdate(update);
  if (!read) return 'malformed';
  if (read.kind === 'full') {
    const keep = new Set<number>();
    for (const entity of read.entities) {
      if (restoreEntity(replica, entity.id, entity.components)) keep.add(entity.id);
    }
    for (const eid of [...getAllEntities(replica.world)]) {
      if (!keep.has(eid)) removeEntity(replica.world, eid);
    }
    replica.tick = read.tick;
    return 'applied';
  }
  if (read.fromTick !== replica.tick) return 'out-of-sequence';
  for (const id of read.removed) {
    if (isEntityId(id, replica.capacity) && entityExists(replica.world, id)) removeEntity(replica.world, id);
  }
  for (const change of read.changed) {
    if (!ensureEntityExists(replica, change.id)) continue;
    removeEntityComponents(replica, change.id, change.removedComponents);
    writeEntityComponents(replica, change.id, change.components);
  }
  replica.tick = read.tick;
  return 'applied';
}

/**
 * The update behind an arbitrary value, with the shape every reader relies
 * on: a kind, integer ticks, arrays of entries whose ids are positive
 * integers and whose components are plain objects. Entries that are not get
 * dropped; anything else wrong makes the whole value undefined. Component
 * names and field values are checked where they are written (restore.ts).
 */
function readWorldStateUpdate(value: unknown): WorldStateUpdate | undefined {
  if (!isRecord(value) || !isTick(value['tick'])) return undefined;
  if (value['kind'] === 'full') {
    if (!Array.isArray(value['entities'])) return undefined;
    const entities: EntitySnapshot[] = [];
    for (const entry of value['entities']) {
      if (isRecord(entry) && isId(entry['id']) && isRecord(entry['components'])) {
        entities.push({ id: entry['id'], components: entry['components'] as Record<string, Record<string, number>> });
      }
    }
    return { kind: 'full', tick: value['tick'], entities };
  }
  if (value['kind'] === 'delta') {
    if (!isTick(value['fromTick']) || value['fromTick'] > value['tick']) return undefined;
    if (!Array.isArray(value['changed']) || !Array.isArray(value['removed'])) return undefined;
    const changed: EntityDelta[] = [];
    for (const entry of value['changed']) {
      if (!isRecord(entry) || !isId(entry['id']) || !isRecord(entry['components'])) continue;
      const components = entry['components'] as Record<string, Record<string, number>>;
      const removedComponents = Array.isArray(entry['removedComponents'])
        ? entry['removedComponents'].filter((name): name is string => typeof name === 'string')
        : undefined;
      changed.push(removedComponents ? { id: entry['id'], components, removedComponents } : { id: entry['id'], components });
    }
    const removed = value['removed'].filter(isId);
    return { kind: 'delta', fromTick: value['fromTick'], tick: value['tick'], changed, removed };
  }
  return undefined;
}

function isTick(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameFields(before: Record<string, number> | undefined, after: Record<string, number>): boolean {
  if (!before) return false;
  const names = Object.keys(after);
  if (names.length !== Object.keys(before).length) return false;
  return names.every((name) => before[name] === after[name]);
}

function sortedFields(fields: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const name of Object.keys(fields).sort()) sorted[name] = fields[name] as number;
  return sorted;
}

function sortedComponents(components: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const sorted: Record<string, Record<string, number>> = {};
  for (const name of Object.keys(components).sort()) sorted[name] = components[name] as Record<string, number>;
  return sorted;
}
