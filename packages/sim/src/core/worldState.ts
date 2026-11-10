import { z } from 'zod';
import { MAX_CAPACITY } from '../content/tuning';
import { getComponentDef } from './components';
import { asEntityWorld } from './entityWorld';
import { mergeComponentFields } from './restore';
import type { SimHandle } from './sim';
import { snapshotEntities } from './snapshot';

/**
 * World state is what a server sends to its players: every entity with every
 * component field, plus the tick it was taken at. No physics bytes and no
 * rng, because a replica never steps (ADR 0004). It is plain JSON.
 *
 * Deltas carry only what changed between two world states, component by
 * component, so static things (terrain) travel once and five walking players
 * cost a few hundred bytes per update.
 */
const tickSchema = z.int().nonnegative();

/** Whether the id fits a world's capacity is checked where it is written (restore.ts): the capacity is not known here. */
const entityIdSchema = z.int().positive();

/**
 * Field name to value. A null is dropped rather than refused: it is how JSON
 * writes NaN and Infinity, so one non-finite value on the server must cost
 * that field (the replica keeps what it had) and not every message from then
 * on, resyncs included. Any other non-number refuses the message.
 */
const fieldsSchema = z
  .record(z.string(), z.number().nullable())
  .transform((fields) => Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, number] => entry[1] !== null)));

/** Component name to fields. Unknown names pass here and are skipped where they are written (restore.ts). */
const componentsSchema = z.record(z.string(), fieldsSchema);

const worldStateSchema = z
  .object({
    kind: z.literal('full'),
    tick: tickSchema,
    /** Sorted by id, like a snapshot's entities. */
    entities: z.array(z.object({ id: entityIdSchema, components: componentsSchema }).readonly()).max(MAX_CAPACITY).readonly(),
  })
  .readonly();

const entityDeltaSchema = z
  .object({
    id: entityIdSchema,
    /** Every field of every component that changed or appeared. */
    components: componentsSchema,
    /** Components the entity lost. Omitted when empty. */
    removedComponents: z.array(z.string()).readonly().optional(),
  })
  .readonly();

const worldStateDeltaSchema = z
  .object({
    kind: z.literal('delta'),
    /** Tick of the state this delta applies to. A replica at any other tick needs a full state instead. */
    fromTick: tickSchema,
    /** Tick of the state this delta produces. */
    tick: tickSchema,
    changed: z.array(entityDeltaSchema).max(MAX_CAPACITY).readonly(),
    /** Ids of entities that no longer exist. */
    removed: z.array(entityIdSchema).max(MAX_CAPACITY).readonly(),
  })
  .refine((delta) => delta.fromTick <= delta.tick)
  .readonly();

const worldStateUpdateSchema = z.discriminatedUnion('kind', [worldStateSchema, worldStateDeltaSchema]);

/**
 * The types are inferred from the schemas above, so what `readWorldStateUpdate`
 * accepts and what the rest of the code may assume can never drift apart.
 */
export type WorldState = z.infer<typeof worldStateSchema>;

/** What changed about one entity. A new entity carries all of its components. */
export type EntityDelta = z.infer<typeof entityDeltaSchema>;

export type WorldStateDelta = z.infer<typeof worldStateDeltaSchema>;

export type WorldStateUpdate = z.infer<typeof worldStateUpdateSchema>;

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
 * neither argument is changed. Both arguments are
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
 * The update behind an arbitrary value, or undefined when it does not match
 * the schemas above: a kind, safe-integer ticks with `fromTick <= tick`,
 * positive safe-integer ids, component fields that are finite numbers (or
 * null, which is dropped: see `fieldsSchema`), at most MAX_CAPACITY entries,
 * changes and removed ids. One bad entry rejects the whole value,
 * because applying part of a state would silently desync a replica; the
 * client asks for a full state instead. The result is a frozen copy. What
 * depends on the world (ids within its capacity, known component and field
 * names) is checked where it is written (restore.ts). Used by
 * `applyWorldState` (replica.ts) and `applyWorldStateDelta`.
 */
export function readWorldStateUpdate(value: unknown): WorldStateUpdate | undefined {
  const result = worldStateUpdateSchema.safeParse(value);
  return result.success ? result.data : undefined;
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
