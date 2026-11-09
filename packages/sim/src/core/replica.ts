import { createWorld, entityExists, getAllEntities, removeEntity, type World } from 'bitecs';
import type { LevelData } from '../content/levels/types';
import { FIXED_DT } from '../content/tuning';
import { ComponentStores, type ComponentDef, type NumericStore } from './components';
import { registerEntityWorld, type EntityWorld } from './entityWorld';
import { ensureEntitiesExist, isEntityId, removeEntityComponents, restoreEntity, writeEntityComponents } from './restore';
import type { SimHandle } from './sim';
import { snapshotEntities, type SimSnapshot } from './snapshot';
import { readWorldStateUpdate, type WorldStateUpdate } from './worldState';

export interface ReplicaConfig {
  readonly level: LevelData;
  /** Must match the authoritative sim's capacity: ids above it are refused. */
  readonly capacity: number;
}

/**
 * What `createReplica` returns: a SimHandle whose state comes from somewhere
 * else. Everything that reads a SimHandle reads it; only `applyWorldState`
 * writes it, and `step` throws.
 */
export interface ReplicaHandle extends SimHandle {
  readonly isReplica: true;
  /** True once a full world state has been applied. Deltas before that are out of sequence. */
  readonly hasState: boolean;
}

/**
 * What applying an update to a replica did. `out-of-sequence` means a delta
 * did not continue from the replica's tick (a message was missed, or no full
 * state has arrived yet): the replica is untouched and needs a full state.
 * `malformed` means the update was not a world state or delta at all.
 */
export type WorldStateApplyResult = 'applied' | 'out-of-sequence' | 'malformed';

/**
 * A read-only copy of a sim that lives somewhere else. It has entities and
 * components, so every view query works on it, but no physics, no rng and no
 * features: it never advances by itself. `applyWorldState` writes what the
 * authoritative sim sent into it. See ADR 0004.
 */
export class Replica implements ReplicaHandle, EntityWorld {
  readonly isReplica = true;
  readonly world: World = createWorld();
  readonly level: LevelData;
  readonly capacity: number;
  readonly dt: number = FIXED_DT;
  /** A replica has no rng, so no seed. */
  readonly seed = 0;
  /** The tick of the last world state applied. */
  tick = 0;
  hasState = false;

  private readonly stores: ComponentStores;

  constructor(config: ReplicaConfig) {
    this.level = config.level;
    this.capacity = config.capacity;
    this.stores = new ComponentStores(this.capacity);
    registerEntityWorld(this, this);
  }

  store<T extends NumericStore>(def: ComponentDef<T>): T {
    return this.stores.get(def);
  }

  componentName(store: object): string | undefined {
    return this.stores.nameOf(store);
  }

  get entityCount(): number {
    return getAllEntities(this.world).length;
  }

  /** A replica never advances by itself; calling this is a bug in the view. */
  step(): never {
    throw new Error('A replica cannot step: it only shows what the authoritative sim sent. Use applyWorldState.');
  }

  /** The entities and the tick. A replica has no physics or rng, so those fields are empty. */
  snapshot(): SimSnapshot {
    return {
      version: 1,
      seed: this.seed,
      level: this.level.name,
      capacity: this.capacity,
      tick: this.tick,
      rng: 0,
      entities: snapshotEntities(this),
      physics: '',
    };
  }

  /** Nothing to release: a replica owns no physics world. */
  destroy(): void {}
}

/**
 * Writes a world state or delta into a replica. This is where network data
 * enters the sim: the update is checked field by field, and anything that is
 * not a valid entity id, a known component or a finite number is skipped.
 * A full state replaces everything the replica had, whatever its tick (the
 * server may have restarted). A delta applies only when a full state has
 * been applied before and it continues from the replica's tick. New ids are
 * allocated in one pass per message (`ensureEntitiesExist`), so a message
 * costs O(capacity + entries) whatever order its ids come in.
 */
export function applyWorldState(handle: ReplicaHandle, update: WorldStateUpdate): WorldStateApplyResult {
  const replica = asReplica(handle);
  const read = readWorldStateUpdate(update);
  if (!read) return 'malformed';
  if (read.kind === 'full') {
    const keep = ensureEntitiesExist(replica, read.entities.map((entity) => entity.id));
    for (const entity of read.entities) {
      if (keep.has(entity.id)) restoreEntity(replica, entity.id, entity.components);
    }
    for (const eid of [...getAllEntities(replica.world)]) {
      if (!keep.has(eid)) removeEntity(replica.world, eid);
    }
    replica.tick = read.tick;
    replica.hasState = true;
    return 'applied';
  }
  if (!replica.hasState || read.fromTick !== replica.tick) return 'out-of-sequence';
  for (const id of read.removed) {
    if (isEntityId(id, replica.capacity) && entityExists(replica.world, id)) removeEntity(replica.world, id);
  }
  const changed = ensureEntitiesExist(replica, read.changed.map((change) => change.id));
  for (const change of read.changed) {
    if (!changed.has(change.id)) continue;
    removeEntityComponents(replica, change.id, change.removedComponents);
    writeEntityComponents(replica, change.id, change.components);
  }
  replica.tick = read.tick;
  return 'applied';
}

/** The Replica behind a handle. Throws for anything else, a live sim included: world states are only ever written into replicas. */
function asReplica(handle: SimHandle): Replica {
  if (!(handle instanceof Replica)) throw new TypeError('Expected a replica created by createReplica');
  return handle;
}
