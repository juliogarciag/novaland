import { getComponentDef } from './components';
import { asEntityWorld } from './entityWorld';
import { mergeComponentFields } from './restore';
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
 * The world state after `delta`, or undefined when either argument is not
 * what its type says or `delta` does not continue from `state.tick`. Pure:
 * neither argument is changed, and the result shares unchanged entity
 * objects with `state`, so never mutate a WorldState. Both arguments are
 * validated like `applyWorldState` validates its input, and the result is
 * what a replica would hold after the same delta. Views do not read world
 * states (they read a replica through the view queries); this is for
 * tooling and tests that work on recorded states and deltas.
 */
export function applyWorldStateDelta(state: WorldState, delta: WorldStateDelta): WorldState | undefined {
  const base = readWorldStateUpdate(state);
  const update = readWorldStateUpdate(delta);
  if (!base || base.kind !== 'full' || !update || update.kind !== 'delta' || update.fromTick !== base.tick) return undefined;
  const byId = new Map(base.entities.map((entity) => [entity.id, entity]));
  for (const id of update.removed) byId.delete(id);
  for (const change of update.changed) {
    const before = byId.get(change.id)?.components ?? {};
    const lost = new Set(change.removedComponents ?? []);
    const merged: Record<string, Record<string, number>> = {};
    for (const name of Object.keys(before)) {
      if (!lost.has(name) && getComponentDef(name)) merged[name] = before[name] as Record<string, number>;
    }
    for (const name of Object.keys(change.components)) {
      const def = getComponentDef(name);
      if (def) merged[name] = mergeComponentFields(def, merged[name], change.components[name]);
    }
    byId.set(change.id, { id: change.id, components: sortedComponents(merged) });
  }
  const entities = [...byId.values()].sort((a, b) => a.id - b.id);
  return { kind: 'full', tick: update.tick, entities };
}

/**
 * The update behind an arbitrary value, with the shape every reader relies
 * on: a kind, integer ticks, arrays of entries whose ids are positive
 * integers and whose components are plain objects. Entries that are not get
 * dropped; anything else wrong makes the whole value undefined. Component
 * names and field values are checked where they are written (restore.ts).
 * Used by `applyWorldState` (replica.ts) and `applyWorldStateDelta`.
 */
export function readWorldStateUpdate(value: unknown): WorldStateUpdate | undefined {
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
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

function sortedComponents(components: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const sorted: Record<string, Record<string, number>> = {};
  for (const name of Object.keys(components).sort()) sorted[name] = components[name] as Record<string, number>;
  return sorted;
}
