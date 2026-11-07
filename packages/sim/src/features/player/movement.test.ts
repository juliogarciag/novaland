import { describe, expect, it } from 'vitest';
import { DefId, getDef } from '../../content/defs';
import { starterLevel } from '../../content/levels/starter';
import { createSim } from '../../core/create';
import { getRenderables } from '../../core/view';
import { findPlayerEntity } from './queries';

const SPEED = getDef(DefId.Player).speed ?? 0;
const RADIUS = getDef(DefId.Player).radius ?? 0;

function playerPosition(sim: Awaited<ReturnType<typeof createSim>>, slot = 0) {
  const eid = findPlayerEntity(sim, slot);
  const r = getRenderables(sim).find((x) => x.eid === eid);
  if (!r) throw new Error('player not rendered');
  return { x: r.x, y: r.y };
}

describe('player movement (headless)', () => {
  it('spawns a player at the level spawn point on join', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    expect(findPlayerEntity(sim, 0)).toBeDefined();
    expect(playerPosition(sim)).toEqual(starterLevel.spawn);
    sim.destroy();
  });

  it('moves at the def speed for N ticks in open space', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    const ticks = 60;
    sim.step([{ type: 'move', slot: 0, x: 1, y: 0 }]);
    for (let i = 1; i < ticks; i += 1) sim.step();
    const { x, y } = playerPosition(sim);
    expect(x).toBeCloseTo(starterLevel.spawn.x + SPEED * ticks * sim.dt, 3);
    expect(y).toBeCloseTo(starterLevel.spawn.y, 6);
    expect(sim.tick).toBe(ticks + 1);
    sim.destroy();
  });

  it('keeps moving with the last intent and stops on a zero move', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    sim.step([{ type: 'move', slot: 0, x: 0, y: -1 }]);
    for (let i = 0; i < 30; i += 1) sim.step();
    const moving = playerPosition(sim);
    expect(moving.y).toBeLessThan(starterLevel.spawn.y);
    sim.step([{ type: 'move', slot: 0, x: 0, y: 0 }]);
    for (let i = 0; i < 30; i += 1) sim.step();
    expect(playerPosition(sim)).toEqual(moving);
    sim.destroy();
  });

  it('normalises diagonal and oversized move vectors to the def speed', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    sim.step([{ type: 'move', slot: 0, x: 10, y: 10 }]);
    for (let i = 0; i < 59; i += 1) sim.step();
    const { x, y } = playerPosition(sim);
    const travelled = Math.hypot(x - starterLevel.spawn.x, y - starterLevel.spawn.y);
    expect(travelled).toBeCloseTo(SPEED * 60 * sim.dt, 3);
    expect(x).toBeCloseTo(y, 6);
    sim.destroy();
  });

  it('is stopped by the east wall (Rapier collision), then slides along it', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    const eastWall = starterLevel.walls.find((w) => w.x > 0 && w.h > w.w);
    if (!eastWall) throw new Error('starter level has no east wall');
    const innerFace = eastWall.x - eastWall.w / 2;

    sim.step([{ type: 'move', slot: 0, x: 1, y: 0 }]);
    for (let i = 0; i < 600; i += 1) sim.step();
    const blocked = playerPosition(sim);
    expect(blocked.x).toBeLessThanOrEqual(innerFace - RADIUS + 0.01);
    expect(blocked.x).toBeGreaterThan(innerFace - RADIUS - 0.2);

    // Pushing into the wall diagonally still moves along it.
    sim.step([{ type: 'move', slot: 0, x: 1, y: 1 }]);
    for (let i = 0; i < 60; i += 1) sim.step();
    const slid = playerPosition(sim);
    expect(slid.y).toBeGreaterThan(blocked.y + 1);
    expect(slid.x).toBeLessThanOrEqual(innerFace - RADIUS + 0.01);
    sim.destroy();
  });

  it('ignores commands for empty or invalid slots and duplicate joins', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'move', slot: 3, x: 1, y: 0 }]);
    sim.step([{ type: 'join', slot: 0 }, { type: 'join', slot: 0 }]);
    sim.step([{ type: 'join', slot: -1 }, { type: 'join', slot: 1.5 }, { type: 'join', slot: Number.NaN }]);
    const players = getRenderables(sim).filter((r) => r.defId === DefId.Player);
    expect(players).toHaveLength(1);
    sim.step([{ type: 'move', slot: 0, x: Number.NaN, y: Number.POSITIVE_INFINITY }]);
    for (let i = 0; i < 10; i += 1) sim.step();
    expect(playerPosition(sim)).toEqual(starterLevel.spawn);
    sim.destroy();
  });

  it('removes the player and its body on leave', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'join', slot: 0 }]);
    const bodiesBefore = sim.physics.bodies.len();
    sim.step([{ type: 'leave', slot: 0 }]);
    expect(findPlayerEntity(sim, 0)).toBeUndefined();
    expect(sim.physics.bodies.len()).toBe(bodiesBefore - 1);
    expect(getRenderables(sim).filter((r) => r.defId === DefId.Player)).toHaveLength(0);
    sim.destroy();
  });
});
