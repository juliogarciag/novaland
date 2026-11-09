import type { World } from 'bitecs';
import type { ComponentDef, NumericStore } from './components';
import type { SimHandle } from './sim';

/**
 * The entities behind a SimHandle: the bitECS world and its component
 * stores. The live Sim and a Replica both provide one, so a view query
 * written once (`getRenderables`, `findPlayerEntity`) works on the real
 * thing and on a copy fed from the network alike. Only code inside
 * packages/sim sees it; views keep holding a SimHandle.
 */
export interface EntityWorld {
  readonly world: World;
  /** Maximum live entities; ids run from 1 to capacity. */
  readonly capacity: number;
  /** The per-world data store for a component. Created on first use. */
  store<T extends NumericStore>(def: ComponentDef<T>): T;
  /** Name of the component a store belongs to, or undefined if it is not one of this world's stores. */
  componentName(store: object): string | undefined;
}

const entityWorldByHandle = new WeakMap<SimHandle, EntityWorld>();

/** Records which EntityWorld a handle gives access to. Called by the Sim and Replica constructors. */
export function registerEntityWorld(handle: SimHandle, entityWorld: EntityWorld): void {
  entityWorldByHandle.set(handle, entityWorld);
}

/** Recovers the entities behind a handle. Only for code inside packages/sim. */
export function asEntityWorld(handle: SimHandle): EntityWorld {
  const entityWorld = entityWorldByHandle.get(handle);
  if (!entityWorld) throw new TypeError('Expected a sim from createSim or a replica from createReplica');
  return entityWorld;
}
