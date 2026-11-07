import { describe, expect, it } from 'vitest';
import { createSimInternal } from '../core/create';
import { getRenderables } from '../core/view';
import { DefId, entityDefs, getDef } from './defs';
import { starterLevel } from './levels/starter';

describe('entity definitions', () => {
  it('have unique, stable ids inside their feature block and resolve by id', () => {
    const ids = entityDefs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getDef(DefId.Player).name).toBe('player');
    expect(DefId.Player).toBeLessThan(100);
    expect(DefId.Wall).toBeGreaterThanOrEqual(100);
    expect(DefId.Wall).toBeLessThan(200);
    expect(() => getDef(999_999)).toThrow(/Unknown entity def/);
  });

  it('walls are spawned from level data, so a new wall is only a data entry', async () => {
    const level = {
      ...starterLevel,
      walls: [...starterLevel.walls, { x: 2, y: 2, w: 1, h: 1, defId: DefId.Wall }],
    };
    const sim = await createSimInternal({ seed: 1, level });
    const walls = getRenderables(sim).filter((r) => r.defId === DefId.Wall);
    expect(walls).toHaveLength(level.walls.length);
    expect(walls.at(-1)).toMatchObject({ x: 2, y: 2, hw: 0.5, hh: 0.5 });
    sim.destroy();
  });
});
