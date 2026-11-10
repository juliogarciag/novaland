import { createSim, MAX_PLAYER_SLOTS, type Command } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { firstEmptySeat, LOCAL_SLOT } from './seats';

describe('seats', () => {
  it('the local player sits in seat 0 and the first empty seat of a fresh world is that one', async () => {
    const sim = await createSim({ seed: 1 });
    expect(LOCAL_SLOT).toBe(0);
    expect(firstEmptySeat(sim, [])).toBe(0);
    sim.destroy();
  });

  it('skips seats that are taken in the sim and seats a queued join is about to take', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([join(0), join(1)]);
    expect(firstEmptySeat(sim, [])).toBe(2);
    expect(firstEmptySeat(sim, [join(2), move(3)])).toBe(3);
    expect(firstEmptySeat(sim, [join(2), join(3), join(4)])).toBe(5);
    sim.destroy();
  });

  it('reports no seat once every one is spoken for', async () => {
    const sim = await createSim({ seed: 1 });
    const everySeat = Array.from({ length: MAX_PLAYER_SLOTS }, (_, slot) => join(slot));
    expect(firstEmptySeat(sim, everySeat)).toBeUndefined();
    sim.destroy();
  });
});

// ---- Helpers ----

const join = (slot: number): Command => ({ type: 'player/join', slot });
const move = (slot: number): Command => ({ type: 'player/move', slot, x: 1, y: 0 });
