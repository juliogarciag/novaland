import { entityExists, hasComponent } from 'bitecs';
import { findDef } from '../content/defs';
import { asEntityWorld } from './entityWorld';
import { Body, detachBody } from './physics';
import { isEntityId, restoreEntity } from './restore';
import { Sim, type SimHandle } from './sim';
import { snapshotEntity } from './snapshot';
import { DefRef } from './transform';

/**
 * What `createPrediction` returns: a sim a client steps by itself to guess
 * where the authoritative sim will put an entity, before the server says so.
 * It is never the truth: whatever it holds is replaced by `adoptEntity` each
 * time the authoritative state arrives. See ADR 0011.
 */
export interface PredictionHandle extends SimHandle {
  /** Tells the type apart from a plain SimHandle, as `isReplica` does for a replica. Inside the package, test `instanceof Prediction`. */
  readonly isPrediction: true;
}

/**
 * A live sim with the level's terrain and every feature, plus the entities
 * adopted from the authoritative state. Internal to packages/sim.
 */
export class Prediction extends Sim implements PredictionHandle {
  readonly isPrediction = true;
  /**
   * Ids of the entities copied in with `adoptEntity`; everything else the
   * prediction made itself. Kept outside components on purpose (rule 3 is
   * about sims whose state is saved or replicated): a prediction is never
   * snapshotted or restored, only thrown away and rebuilt.
   */
  readonly adoptedEntityIds = new Set<number>();
}

/**
 * Makes entity `eid` of the prediction what it is in `source` (a replica of
 * the authoritative sim): the same id, the same components and the body its
 * feature attaches (`Feature.attachBody`). `Body` is not copied: its handle
 * names a body in the server's physics world.
 *
 * True when the prediction now holds the entity, with a body. False, and the
 * prediction holds no adopted entity `eid`, when `source` has no such entity,
 * when it points at no def, when the prediction already uses the id for
 * something it made itself (terrain), or when no feature gave it a body.
 * `source` is filled from the network, so none of that throws.
 */
export function adoptEntity(handle: PredictionHandle, source: SimHandle, eid: number): boolean {
  const prediction = asPrediction(handle);
  const sourceWorld = asEntityWorld(source);
  const ownsId = entityExists(prediction.world, eid) && !prediction.adoptedEntityIds.has(eid);
  if (ownsId || !isEntityId(eid, Math.min(prediction.capacity, sourceWorld.capacity)) || !entityExists(sourceWorld.world, eid)) {
    releaseAdoptedEntity(prediction, eid);
    return false;
  }
  // Everything but Body: its handle names a body in the server's physics world.
  const components = Object.fromEntries(Object.entries(snapshotEntity(sourceWorld, eid).components).filter(([name]) => name !== Body.name));
  const defId = components[DefRef.name]?.id;
  if (defId === undefined || !findDef(defId)) {
    releaseAdoptedEntity(prediction, eid);
    return false;
  }
  if (prediction.adoptedEntityIds.has(eid)) detachBody(prediction, eid);
  prediction.adoptedEntityIds.add(eid);
  restoreEntity(prediction, eid, components);
  for (const feature of prediction.features) feature.attachBody?.(prediction, eid);
  if (!hasComponent(prediction.world, eid, prediction.store(Body))) {
    releaseAdoptedEntity(prediction, eid);
    return false;
  }
  return true;
}

/** Removes every entity the prediction adopted, bodies included. What it made itself (terrain) stays. */
export function releaseAdoptedEntities(handle: PredictionHandle): void {
  const prediction = asPrediction(handle);
  for (const eid of [...prediction.adoptedEntityIds]) releaseAdoptedEntity(prediction, eid);
}

function releaseAdoptedEntity(prediction: Prediction, eid: number): void {
  if (!prediction.adoptedEntityIds.delete(eid)) return;
  if (entityExists(prediction.world, eid)) prediction.destroyEntity(eid);
}

/** The Prediction behind a handle. Throws for anything else: entities are only ever adopted into a prediction, never into the sim a server steps. */
function asPrediction(handle: SimHandle): Prediction {
  if (!(handle instanceof Prediction)) throw new TypeError('Expected a prediction created by createPrediction');
  return handle;
}
