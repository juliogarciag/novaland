import { createSim, findPlayerEntity, MAX_PLAYER_SLOTS, starterLevel } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { LOCAL_SLOT } from '../seats';
import { LocalWorld } from './LocalWorld';

describe('LocalWorld', () => {
  it('seats the local player on the first tick and steps only whole ticks of real time', async () => {
    const world = await freshWorld();
    world.nextFrame([], world.sim.dt / 2);
    expect(world.sim.tick).toBe(0);
    const frame = world.nextFrame([], world.sim.dt / 2);
    expect(world.sim.tick).toBe(1);
    expect(frame.tick).toBe(1);
    expect(findPlayerEntity(world.sim, LOCAL_SLOT)).toBeDefined();
  });

  it('runs queued commands on the next earned tick, like keyboard commands', async () => {
    const world = await freshWorld();
    world.queueCommand({ type: 'player/join', slot: 2 });
    world.nextFrame([], world.sim.dt);
    expect(findPlayerEntity(world.sim, 2)).toBeDefined();
  });

  it('seats another player in each lowest empty seat, even several in one frame, and stops when every seat is taken', async () => {
    const world = await freshWorld();
    world.joinAnotherSeat();
    world.joinAnotherSeat();
    world.nextFrame([], world.sim.dt);
    expect([0, 1, 2].map((slot) => findPlayerEntity(world.sim, slot) !== undefined)).toEqual([true, true, true]);
    for (let seat = 0; seat < MAX_PLAYER_SLOTS + 2; seat += 1) world.joinAnotherSeat();
    world.nextFrame([], world.sim.dt);
    const seated = Array.from({ length: MAX_PLAYER_SLOTS }, (_, slot) => findPlayerEntity(world.sim, slot)).filter((eid) => eid !== undefined);
    expect(seated).toHaveLength(MAX_PLAYER_SLOTS);
  });
});

// ---- Helpers ----

async function freshWorld(): Promise<LocalWorld> {
  return new LocalWorld(await createSim({ seed: 1, level: starterLevel }));
}
