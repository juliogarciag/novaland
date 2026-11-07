import { describe, expect, it } from 'vitest';
import { runHeadless } from './headless';

describe('server headless run', () => {
  it('drives the sim without a browser and is reproducible', async () => {
    const a = await runHeadless({ ticks: 300, seed: 7 });
    const b = await runHeadless({ ticks: 300, seed: 7 });
    expect(a.ticks).toBe(300);
    expect(a.player).not.toBeNull();
    expect(a.player?.x).toBeGreaterThan(0);
    expect(a.player?.y).toBeGreaterThan(0);
    expect(a.hash).toBe(b.hash);
  });
});
