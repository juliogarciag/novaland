import { describe, expect, it } from 'vitest';
import { createReplica } from './create';
import { createPhysicsWorld, initPhysics } from './physics';
import { starterLevel } from '../content/levels/starter';
import { getRenderables } from './view';

// Vitest runs each test file in its own module graph, so Rapier starts unloaded here.
describe('physics loads on demand', () => {
  it('builds a replica and reads it with no physics loaded', () => {
    const replica = createReplica({ level: starterLevel });
    expect(getRenderables(replica)).toEqual([]);
  });

  it('refuses to build a physics world before initPhysics has finished, saying so', () => {
    expect(() => createPhysicsWorld(1 / 60)).toThrow(/await initPhysics\(\)/);
  });

  it('loads Rapier once however often it is asked, and builds a physics world after', async () => {
    const first = initPhysics();
    expect(initPhysics()).toBe(first);
    await first;
    expect(createPhysicsWorld(1 / 60).timestep).toBeCloseTo(1 / 60);
  });
});
