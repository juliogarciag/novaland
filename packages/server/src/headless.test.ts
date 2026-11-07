import { FIXED_DT, getDef, DefId } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { runHeadless, SCRIPT } from './headless';

describe('server headless run', () => {
  it('drives the sim without a browser and is reproducible', async () => {
    const a = await runHeadless({ ticks: 300, seed: 7 });
    const b = await runHeadless({ ticks: 300, seed: 7 });
    expect(a.ticks).toBe(300);
    expect(a.player).not.toBeNull();
    // Right from tick 1 to 120, then down until 180, then stopped.
    expect(a.player?.x).toBeCloseTo(SPEED * (SCRIPT.down - SCRIPT.right) * FIXED_DT, 3);
    expect(a.player?.y).toBeCloseTo(SPEED * (SCRIPT.stop - SCRIPT.down) * FIXED_DT, 3);
    expect(a.hash).toBe(b.hash);
  });

  it('the stop command really stops the player', async () => {
    const atStop = await runHeadless({ ticks: SCRIPT.stop + 1, seed: 7 });
    const later = await runHeadless({ ticks: 300, seed: 7 });
    expect(later.player).toEqual(atStop.player);
  });

  it('runs exactly the requested number of ticks', async () => {
    expect((await runHeadless({ ticks: 0 })).ticks).toBe(0);
    expect((await runHeadless({ ticks: 1 })).ticks).toBe(1);
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const SPEED = getDef(DefId.Player).speed ?? 0;
