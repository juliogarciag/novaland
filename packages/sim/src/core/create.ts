import { features } from '../features';
import { initPhysics } from './physics';
import { Sim, type SimOptions } from './sim';

/** Creates a sim with every registered feature. Loads the physics engine on first call. */
export async function createSim(options: SimOptions = {}): Promise<Sim> {
  await initPhysics();
  const sim = new Sim(options, features);
  for (const feature of features) feature.init?.(sim);
  return sim;
}
