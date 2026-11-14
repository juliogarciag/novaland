import { createSim, findPlayerEntity, getDef, getRenderables, starterLevel } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from '../worlds/LocalWorld';
import type { PlayableWorld } from '../worlds/PlayableWorld';
import { hudLines } from './hudLines';

describe('hudLines', () => {
  it('solo shows the frame rate and no latency, seats, tick or movement help', async () => {
    const world = await seatedSoloWorld();
    const lines = hudLines(world, { framesPerSecond: 59.6 });
    expect(lines[0]).toBe('fps 60');
    expect(lines.join('\n')).not.toMatch(/latency|online|tick|WASD|arrows/i);
  });

  it('online shows the frame rate, the round trip to the server and the seats taken', async () => {
    const world = online(await seatedSoloWorld(), { latencyMs: 41.7 });
    expect(hudLines(world, { framesPerSecond: 120 })[0]).toBe('fps 120   latency 42 ms   2/5 online');
  });

  it('shows -- for what has not been measured yet, never a made-up number', async () => {
    const world = online(await seatedSoloWorld(), { latencyMs: undefined });
    expect(hudLines(world, { framesPerSecond: undefined })[0]).toBe('fps --   latency -- ms   2/5 online');
  });

  it('keeps who you are, the player count and the dev J hint where the world offers it', async () => {
    const world = await seatedSoloWorld();
    const avatar = getRenderables(world.sim).find((renderable) => renderable.eid === findPlayerEntity(world.sim, world.localSlot))!;
    expect(hudLines(world, { framesPerSecond: 60 }).slice(1)).toEqual([`you: ${getDef(avatar.defId).name}   players: 1`, 'J: seat another player (dev)']);
    expect(hudLines(online(world, { latencyMs: 20 }), { framesPerSecond: 60 })).toHaveLength(2);
  });

  it('says joining... until the local player has an avatar', async () => {
    const world = new LocalWorld(await createSim({ seed: 1, level: starterLevel }));
    expect(hudLines(world, { framesPerSecond: 60 })[1]).toBe('you: joining...   players: 0');
  });
});

// ---- Helpers ----

/** A solo world whose local player has joined. */
async function seatedSoloWorld(): Promise<LocalWorld> {
  const world = new LocalWorld(await createSim({ seed: 1, level: starterLevel }));
  world.nextFrame([], world.sim.dt);
  return world;
}

/** The same world as an online one would present it: seats counted, a latency, no dev seat key. */
function online(world: LocalWorld, { latencyMs }: { latencyMs: number | undefined }): PlayableWorld {
  return {
    sim: world.sim,
    localSlot: world.localSlot,
    occupancy: { online: 2, seats: 5 },
    latencyMs,
    nextFrame: (commands, deltaSeconds) => world.nextFrame(commands, deltaSeconds),
    queueCommand: (command) => world.queueCommand(command),
  };
}
