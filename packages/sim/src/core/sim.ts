import type { World as PhysicsWorld } from '@dimforge/rapier2d-deterministic-compat';
import { addEntity, createWorld, removeEntity, type World } from 'bitecs';
import { DEFAULT_CAPACITY, FIXED_DT } from '../content/tuning';
import { starterLevel } from '../content/levels/starter';
import type { LevelData } from '../content/levels/types';
import type { Command } from './commands';
import type { ComponentDef, NumericStore } from './components';
import type { Feature } from './feature';
import { createPhysicsWorld, detachBody, syncBodiesToPositions } from './physics';
import { createRng, type Rng } from './rng';
import { takeSnapshot, type SimSnapshot } from './snapshot';

export interface SimOptions {
  /** Seed for sim.rng. Same seed + same commands = same state. */
  readonly seed?: number;
  readonly level?: LevelData;
  /** Maximum live entities. */
  readonly capacity?: number;
}

/**
 * The single source of truth for the game. Holds the ECS world, the physics
 * world, the rng and the tick counter, and advances them one fixed step at a
 * time through `step`. Construct it with `createSim` (which loads physics and
 * wires the feature list); use `new Sim(...)` directly only in tests that
 * want a custom feature list.
 */
export class Sim {
  readonly world: World = createWorld();
  readonly physics: PhysicsWorld;
  readonly rng: Rng;
  readonly seed: number;
  readonly level: LevelData;
  readonly capacity: number;
  readonly dt: number = FIXED_DT;
  readonly features: readonly Feature[];
  tick = 0;

  private readonly stores = new Map<ComponentDef, NumericStore>();
  private readonly storeNames = new Map<NumericStore, string>();

  constructor(options: SimOptions, features: readonly Feature[]) {
    this.seed = options.seed ?? 0;
    this.level = options.level ?? starterLevel;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.rng = createRng(this.seed);
    this.physics = createPhysicsWorld(this.dt);
    this.features = features;
  }

  /** The per-sim data store for a component. Created on first use. */
  store<T extends NumericStore>(def: ComponentDef<T>): T {
    let store = this.stores.get(def);
    if (!store) {
      store = def.create(this.capacity);
      this.stores.set(def, store);
      this.storeNames.set(store, def.name);
    }
    return store as T;
  }

  /** Name of the component a store belongs to, or undefined if it is not one of this sim's stores. */
  componentName(store: object): string | undefined {
    return this.storeNames.get(store as NumericStore);
  }

  /** Allocates an entity id, guarding the typed-array capacity. Always use this instead of bitecs' addEntity. */
  createEntity(): number {
    const eid = addEntity(this.world);
    if (eid >= this.capacity) {
      removeEntity(this.world, eid);
      throw new Error(`Sim is full: capacity is ${this.capacity} entities`);
    }
    return eid;
  }

  /** Removes an entity and its physics body, if any. */
  destroyEntity(eid: number): void {
    detachBody(this, eid);
    removeEntity(this.world, eid);
  }

  /** Advances the sim by exactly one fixed tick, applying `commands` first. */
  step(commands: readonly Command[] = []): void {
    for (const command of commands) {
      for (const feature of this.features) feature.handleCommand?.(this, command);
    }
    for (const feature of this.features) feature.update?.(this);
    this.physics.step();
    syncBodiesToPositions(this);
    for (const feature of this.features) feature.postStep?.(this);
    this.tick += 1;
  }

  /** Full serializable state. */
  snapshot(): SimSnapshot {
    return takeSnapshot(this);
  }

  /** Releases the physics world. The sim must not be used afterwards. */
  destroy(): void {
    this.physics.free();
  }
}
