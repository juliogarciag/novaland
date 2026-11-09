import { createWorld, getAllEntities, type World } from 'bitecs';
import type { LevelData } from '../content/levels/types';
import { FIXED_DT } from '../content/tuning';
import { ComponentStores, type ComponentDef, type NumericStore } from './components';
import { registerEntityWorld, type EntityWorld } from './entityWorld';
import type { SimHandle } from './sim';
import { snapshotEntities, type SimSnapshot } from './snapshot';

export interface ReplicaConfig {
  readonly level: LevelData;
  /** Must match the authoritative sim's capacity: ids above it are refused. */
  readonly capacity: number;
}

/**
 * A read-only copy of a sim that lives somewhere else. It has entities and
 * components, so every view query works on it, but no physics, no rng and no
 * features: it never advances by itself. `applyWorldState` (worldState.ts)
 * writes what the authoritative sim sent into it. See ADR 0004.
 */
export class Replica implements SimHandle, EntityWorld {
  readonly world: World = createWorld();
  readonly level: LevelData;
  readonly capacity: number;
  readonly dt: number = FIXED_DT;
  /** A replica has no rng, so no seed. */
  readonly seed = 0;
  /** The tick of the last world state applied. */
  tick = 0;

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

/** Recovers the Replica behind a handle. Throws for a live sim: world states are only ever applied to replicas. */
export function asReplica(handle: SimHandle): Replica {
  if (!(handle instanceof Replica)) throw new TypeError('Expected a replica created by createReplica');
  return handle;
}
