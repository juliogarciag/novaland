import { createSim, findPlayerEntity, guestCharacter, MAX_PLAYER_SLOTS, readMapTiles, worldMap } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { LOCAL_SLOT } from '../seats';
import { createLocalWorld, LocalWorld } from './LocalWorld';

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
    world.queueCommand({ type: 'player/join', slot: 2, character: guestCharacter(2) });
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

describe('createLocalWorld', () => {
  it('plays the world unless a generated map is asked for by size', async () => {
    expect((await createLocalWorld({ character: guestCharacter(LOCAL_SLOT) })).sim.map).toBe(worldMap);
    const big = await createLocalWorld({ character: guestCharacter(LOCAL_SLOT), generatedMap: '400x300' });
    expect(readMapTiles(big.sim.map).bounds).toEqual({ column: 0, row: 0, width: 400, height: 300 });
  });

  it('refuses a size it cannot read instead of quietly playing the world', async () => {
    for (const size of ['', 'big', '400', '400x', '400x300x2', '-4x30', '4.5x30']) await expect(createLocalWorld({ character: guestCharacter(LOCAL_SLOT), generatedMap: size }), size).rejects.toThrow(/VITE_GENERATED_MAP/);
  });
});

// ---- Helpers ----

async function freshWorld(): Promise<LocalWorld> {
  return new LocalWorld(await createSim({ seed: 1 }), guestCharacter(LOCAL_SLOT));
}
