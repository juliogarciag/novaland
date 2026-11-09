import { addComponent, addEntity, entityExists, getEntityComponents, hasComponent, removeComponent, removeEntity, type World } from 'bitecs';
import { getComponentDef, type ComponentDef, type NumericArray } from './components';
import type { EntityWorld } from './entityWorld';

/**
 * Writing snapshot data back into component stores. A replica fills itself
 * with it from world states that arrived over the network (worldState.ts),
 * and restoring a saved snapshot into a live sim (ticket #2) builds on the
 * same functions before it adds the physics world and the rng on top.
 *
 * Everything here treats its input as untrusted: ids outside the world's
 * capacity, unknown components, unknown fields and values that are not
 * finite numbers are skipped, never thrown on.
 */

/** True when `id` can be an entity of a world with `capacity` entities. */
export function isEntityId(id: unknown, capacity: number): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= capacity;
}

/** True when `value` may be written into a component field: JSON cannot carry anything else. */
export function isFieldValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const fieldNamesByDef = new Map<ComponentDef, readonly string[]>();

/** The field names of a component, sorted, as its snapshot lists them. */
export function componentFieldNames(def: ComponentDef): readonly string[] {
  let names = fieldNamesByDef.get(def);
  if (!names) {
    names = Object.keys(def.create(1)).sort();
    fieldNamesByDef.set(def, names);
  }
  return names;
}

/**
 * The component fields the sim would end up with after writing `fields` over
 * `before`: every field of the component, taken from `fields` where it holds
 * a finite number, else from `before`, else 0. This is the pure form of
 * `writeEntityComponents` for one component; the two must agree.
 */
export function mergeComponentFields(def: ComponentDef, before: Record<string, number> | undefined, fields: unknown): Record<string, number> {
  const merged: Record<string, number> = {};
  const given = isRecord(fields) ? fields : {};
  for (const name of componentFieldNames(def)) {
    const value = given[name];
    merged[name] = isFieldValue(value) ? value : (before?.[name] ?? 0);
  }
  return merged;
}

/**
 * Makes `id` a live entity of the world, or leaves it alone if it already
 * is. bitECS picks ids itself: freed ids are handed out again first, then a
 * counter, so this allocates until `id` comes out and frees whatever came out
 * before it. That takes at most capacity + id allocations, so an id this
 * loop cannot reach (which no bitECS world without versioning produces) is
 * given up on rather than spun on. Returns whether `id` is alive afterwards.
 */
export function ensureEntityExists(entityWorld: EntityWorld, id: number): boolean {
  if (!isEntityId(id, entityWorld.capacity)) return false;
  const world: World = entityWorld.world;
  if (entityExists(world, id)) return true;
  const spare: number[] = [];
  let found = false;
  for (let attempt = 0; attempt <= entityWorld.capacity + id; attempt += 1) {
    const eid = addEntity(world);
    if (eid === id) {
      found = true;
      break;
    }
    spare.push(eid);
  }
  for (const eid of spare) removeEntity(world, eid);
  return found;
}

/**
 * Attaches the named components to entity `eid` (which must exist) and
 * writes their fields. A component the entity did not have yet gets every
 * field written, zero where the input has none, so nothing left behind by a
 * previous owner of the id shows through. A component it already had keeps
 * the fields the input does not mention.
 */
export function writeEntityComponents(entityWorld: EntityWorld, eid: number, components: unknown): void {
  if (!isRecord(components)) return;
  for (const name of Object.keys(components)) {
    const def = getComponentDef(name);
    const fields = components[name];
    if (!def || !isRecord(fields)) continue;
    const store = entityWorld.store(def);
    const isNew = !hasComponent(entityWorld.world, eid, store);
    if (isNew) addComponent(entityWorld.world, eid, store);
    for (const field of componentFieldNames(def)) {
      const value = fields[field];
      const array = store[field] as NumericArray;
      if (isFieldValue(value)) array[eid] = value;
      else if (isNew) array[eid] = 0;
    }
  }
}

/** Detaches the named components from entity `eid`, ignoring names it does not have or that are not components. */
export function removeEntityComponents(entityWorld: EntityWorld, eid: number, names: unknown): void {
  if (!Array.isArray(names)) return;
  for (const name of names) {
    const def = typeof name === 'string' ? getComponentDef(name) : undefined;
    if (!def) continue;
    const store = entityWorld.store(def);
    if (hasComponent(entityWorld.world, eid, store)) removeComponent(entityWorld.world, eid, store);
  }
}

/**
 * Makes entity `id` exist with exactly the given components: the whole
 * entity as a full snapshot describes it. Components the entity had that the
 * input does not name are detached. Returns false, having changed nothing,
 * when `id` is not a valid entity id.
 */
export function restoreEntity(entityWorld: EntityWorld, id: number, components: unknown): boolean {
  if (!ensureEntityExists(entityWorld, id)) return false;
  writeEntityComponents(entityWorld, id, components);
  const keep = new Set(isRecord(components) ? Object.keys(components) : []);
  const extra: string[] = [];
  for (const store of getEntityComponents(entityWorld.world, id)) {
    const name = entityWorld.componentName(store);
    if (name !== undefined && !keep.has(name)) extra.push(name);
  }
  removeEntityComponents(entityWorld, id, extra);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
