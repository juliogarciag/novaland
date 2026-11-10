import { starterLevel } from '../content/levels/starter';
import type { LevelData } from '../content/levels/types';
import { DEFAULT_CAPACITY, MAX_CAPACITY } from '../content/tuning';
import { features } from '../features';
import { initPhysics } from './physics';
import { Replica, type ReplicaHandle } from './replica';
import { Sim, type SimHandle } from './sim';

export interface SimOptions {
  /** Seed for sim.rng. Same seed + same commands = same state. Default 0. */
  readonly seed?: number;
  /** Default: the starter level. */
  readonly level?: LevelData;
  /** Maximum live entities. Default: DEFAULT_CAPACITY. */
  readonly capacity?: number;
}

/** Creates a sim with every registered feature. Loads the physics engine on first call. Returns the full Sim, so it stays internal. */
async function createSimInternal(options: SimOptions = {}): Promise<Sim> {
  await initPhysics();
  return new Sim(
    { seed: options.seed ?? 0, level: options.level ?? starterLevel, capacity: options.capacity ?? DEFAULT_CAPACITY },
    features,
  );
}

/** Creates a sim with every registered feature and hands back its public handle. */
export const createSim: (options?: SimOptions) => Promise<SimHandle> = createSimInternal;

export interface ReplicaOptions {
  /** The level the authoritative sim runs. */
  readonly level: LevelData;
  /** Must match the authoritative sim's capacity. Default: DEFAULT_CAPACITY. */
  readonly capacity?: number;
}

/**
 * Creates an empty read-only copy of a sim that runs elsewhere. Fill it with
 * `applyWorldState`; read it with the same view queries as a live sim. No
 * physics loads, so this is synchronous. Importing `features` above has
 * registered every component, so the names in a world state resolve.
 *
 * The capacity usually arrives in the server's welcome message, so it is
 * checked here: anything but an integer in 1..MAX_CAPACITY throws a
 * RangeError, before any store is allocated or any id is scanned.
 */
export function createReplica(options: ReplicaOptions): ReplicaHandle {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new RangeError(`Replica capacity must be an integer from 1 to ${MAX_CAPACITY}, got ${String(capacity)}`);
  }
  return new Replica({ level: options.level, capacity });
}

/** Test-only access to the full Sim. Lint forbids importing this outside *.test.ts. */
export const __testing__ = { createSimInternal };
