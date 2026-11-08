import { describe, expect, it } from 'vitest';
import { DefId } from '../../content/defs';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { getRenderables } from '../../core/view';
import { findPlayerEntity, getPlayerHeading } from './queries';

describe('player facing (headless)', () => {
  it('spawns facing down with no move intent', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    expect(heading(sim)).toEqual({ moveIntent: { x: 0, y: 0 }, facing: { x: 0, y: 1 } });
    sim.destroy();
  });

  it('turns to face a non-zero move intent and keeps facing it after a stop', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(-1, 0)]);
    expect(heading(sim)).toEqual({ moveIntent: { x: -1, y: 0 }, facing: { x: -1, y: 0 } });
    for (let i = 0; i < 20; i += 1) sim.step();
    sim.step([move(0, 0)]);
    for (let i = 0; i < 20; i += 1) sim.step();
    expect(heading(sim)).toEqual({ moveIntent: { x: 0, y: 0 }, facing: { x: -1, y: 0 } });
    sim.step([move(0, -1)]);
    expect(heading(sim).facing).toEqual({ x: 0, y: -1 });
    sim.destroy();
  });

  it('stores the facing as a unit vector even when the intent is shorter or longer than one', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(0.3, 0.4)]);
    expect(heading(sim).moveIntent).toEqual({ x: 0.3, y: 0.4 });
    expect(heading(sim).facing.x).toBeCloseTo(0.6, 12);
    expect(heading(sim).facing.y).toBeCloseTo(0.8, 12);
    sim.step([move(10, 10)]);
    expect(Math.hypot(heading(sim).facing.x, heading(sim).facing.y)).toBeCloseTo(1, 12);
    expect(heading(sim).facing.x).toBeCloseTo(heading(sim).facing.y, 12);
    sim.destroy();
  });

  it('ignores malformed move vectors without changing the facing', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(1, 0)]);
    sim.step([move(Number.NaN, 1), move(Number.POSITIVE_INFINITY, 0), { type: 'player/move', slot: 0, x: '1', y: 0 } as unknown as Command]);
    expect(heading(sim)).toEqual({ moveIntent: { x: 0, y: 0 }, facing: { x: 1, y: 0 } });
    sim.destroy();
  });

  it('is part of the snapshot, so it survives serialization and feeds the state hash', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    sim.step([move(0, -1)]);
    const player = sim.snapshot().entities.find((entity) => entity.components['Player']);
    expect(player?.components['Facing']).toEqual({ x: 0, y: -1 });
    sim.destroy();
  });

  it('resets to facing down when a recycled entity id is reused by a new join', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    const first = findPlayerEntity(sim, 0);
    sim.step([move(1, 0)]);
    sim.step([{ type: 'player/leave', slot: 0 }]);
    sim.step([join()]);
    expect(findPlayerEntity(sim, 0)).toBe(first);
    expect(heading(sim).facing).toEqual({ x: 0, y: 1 });
    sim.destroy();
  });

  it('has no heading for entities that are not players or do not exist', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join()]);
    const wall = getRenderables(sim).find((renderable) => renderable.defId === DefId.Wall);
    expect(wall).toBeDefined();
    expect(getPlayerHeading(sim, wall!.eid)).toBeUndefined();
    expect(getPlayerHeading(sim, 0)).toBeUndefined();
    expect(getPlayerHeading(sim, -1)).toBeUndefined();
    expect(getPlayerHeading(sim, 1.5)).toBeUndefined();
    expect(getPlayerHeading(sim, sim.capacity + 10)).toBeUndefined();
    expect(getPlayerHeading(sim, Number.NaN)).toBeUndefined();
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;

const join = (slot = 0): Command => ({ type: 'player/join', slot });
const move = (x: number, y: number, slot = 0): Command => ({ type: 'player/move', slot, x, y });

function heading(sim: Sim, slot = 0) {
  const eid = findPlayerEntity(sim, slot);
  if (eid === undefined) throw new Error('no player in slot');
  const playerHeading = getPlayerHeading(sim, eid);
  if (!playerHeading) throw new Error('player has no heading');
  return playerHeading;
}
