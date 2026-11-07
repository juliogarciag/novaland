import { describe, expect, it } from 'vitest';
import { createSim } from '../core/create';
import { getRenderables } from '../core/view';
import { DefId, entityDefs, getDef } from './defs';
import { starterLevel } from './levels/starter';

describe('entity definitions', () => {
  it('have unique, stable ids and resolve by id', () => {
    const ids = entityDefs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getDef(DefId.Player).name).toBe('player');
    expect(() => getDef(999_999)).toThrow(/Unknown entity def/);
  });

  it('a new wall kind is only a data entry: level data can point at any def id', async () => {
    const level = {
      ...starterLevel,
      walls: [...starterLevel.walls, { x: 2, y: 2, w: 1, h: 1, defId: DefId.Wall }],
    };
    const sim = await createSim({ seed: 1, level });
    const walls = getRenderables(sim).filter((r) => r.defId === DefId.Wall);
    expect(walls).toHaveLength(level.walls.length);
    sim.destroy();
  });
});
