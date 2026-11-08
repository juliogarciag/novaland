import { starterLevel } from '../content/levels/starter';
import type { LevelData } from '../content/levels/types';
import { DEFAULT_CAPACITY } from '../content/tuning';
import { features } from '../features';
import { initPhysics } from './physics';
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

/** Test-only access to the full Sim. Lint forbids importing this outside *.test.ts. */
export const __testing__ = { createSimInternal };
