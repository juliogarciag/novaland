import { describe, expect, it } from 'vitest';
import { createSim } from '../../core/create';
import { findLevel, levels } from './index';
import { starterLevel } from './starter';

describe('levels by name', () => {
  it('resolves the name a snapshot or a welcome message carries to the level object', async () => {
    const sim = await createSim();
    expect(findLevel(sim.snapshot().level)).toBe(sim.level);
    expect(findLevel(starterLevel.name)).toBe(starterLevel);
    sim.destroy();
  });

  it('answers undefined for a name it does not know, including prototype names', () => {
    for (const name of ['', 'nope', 'Starter', '__proto__', 'constructor', 'toString']) {
      expect(findLevel(name)).toBeUndefined();
    }
  });

  it('lists every level once, under a unique name', () => {
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels.map((level) => level.name)).size).toBe(levels.length);
    for (const level of levels) expect(findLevel(level.name)).toBe(level);
  });
});
