import type { World as PhysicsWorld } from '@dimforge/rapier2d-deterministic-compat';
import { addEntity, createWorld, getAllEntities, removeEntity, type World } from 'bitecs';
import { FIXED_DT } from '../content/tuning';
import type { LevelData } from '../content/levels/types';
import { isCommandShaped, type Command } from './commands';
import type { ComponentDef, NumericStore } from './components';
import type { Feature } from './feature';
import { createPhysicsWorld, detachBody, syncBodiesToPositions } from './physics';
import { createRng, type Rng } from './rng';
import { takeSnapshot, type SimSnapshot } from './snapshot';

export interface SimConfig {
  /** Seed for sim.rng. Same seed + same commands = same state. */
  readonly seed: number;
  readonly level: LevelData;
  /** Maximum live entities. */
  readonly capacity: number;
}

/**
 * What views and servers get from `createSim`. It can advance the sim and
 * read it; it cannot reach components, physics or the rng. Everything that
 * changes game state goes through `step(commands)`.
 */
export interface SimHandle {
  readonly tick: number;
  readonly dt: number;
  readonly seed: number;
  readonly level: LevelData;
  readonly capacity: number;
  readonly entityCount: number;
  /** Advances the sim by exactly one fixed tick, applying `commands` first. */
  step(commands?: readonly Command[]): void;
  /** Full serializable state. */
  snapshot(): SimSnapshot;
  /** Releases the physics world. The sim must not be used afterwards. */
  destroy(): void;
}

/**
 * The single source of truth for the game. Holds the ECS world, the physics
 * world, the rng and the tick counter, and advances them one fixed step at a
 * time through `step`. Internal to packages/sim: features and core see the
 * class, everyone else gets a SimHandle from `createSim`.
 *
 * Constructing one directly (tests with a custom feature list) requires
 * `await initPhysics()` first.
 */
export class Sim implements SimHandle {
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

  constructor(config: SimConfig, features: readonly Feature[]) {
    this.seed = config.seed;
    this.level = config.level;
    this.capacity = config.capacity;
    this.rng = createRng(this.seed);
    this.physics = createPhysicsWorld(this.dt);
    this.features = features;
    for (const feature of features) feature.init?.(this);
  }

  /** The per-sim data store for a component. Created on first use. */
  store<T extends NumericStore>(def: ComponentDef<T>): T {
    let store = this.stores.get(def);
    if (!store) {
      // bitECS hands out ids starting at 1, so index 0 is never used.
      store = def.create(this.capacity + 1);
      this.stores.set(def, store);
      this.storeNames.set(store, def.name);
    }
    return store as T;
  }

  /** Name of the component a store belongs to, or undefined if it is not one of this sim's stores. */
  componentName(store: object): string | undefined {
    return this.storeNames.get(store as NumericStore);
  }

  get entityCount(): number {
    return getAllEntities(this.world).length;
  }

  /** True when no more entities fit. Command handlers should check this and ignore the command rather than throw. */
  get isFull(): boolean {
    return this.entityCount >= this.capacity;
  }

  /** Allocates an entity id, guarding the typed-array capacity. Always use this instead of bitecs' addEntity. */
  createEntity(): number {
    const eid = addEntity(this.world);
    if (eid > this.capacity) {
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

  step(commands: readonly Command[] = []): void {
    if (!Array.isArray(commands)) {
      throw new TypeError('sim.step expects an array of commands');
    }
    for (const command of commands) {
      if (!isCommandShaped(command)) continue;
      for (const feature of this.features) feature.handleCommand?.(this, command);
    }
    for (const feature of this.features) feature.update?.(this);
    this.physics.step();
    syncBodiesToPositions(this);
    for (const feature of this.features) feature.postStep?.(this);
    this.tick += 1;
  }

  snapshot(): SimSnapshot {
    return takeSnapshot(this);
  }

  destroy(): void {
    this.physics.free();
  }
}

/** Recovers the internal Sim behind a handle. Only for code inside packages/sim. */
export function asSim(handle: SimHandle): Sim {
  if (!(handle instanceof Sim)) throw new TypeError('Expected a sim created by createSim');
  return handle;
}
