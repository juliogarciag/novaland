import { describe, expect, it } from 'vitest';
import { __testing__ } from '../core/create';
import { getRenderables } from '../core/view';
import { avatarDefIds, isAvatarDefId } from '../features/player/defs';
import { getTileDef, terrainDefs } from '../features/terrain/defs';
import { DefId, entityDefs, getDef } from './defs';
import { starterLevel } from './levels/starter';

describe('entity definitions', () => {
  it('have unique, stable ids inside their feature block and resolve by id', () => {
    const ids = entityDefs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getDef(DefId.Sky).name).toBe('player-sky');
    for (const avatarDefId of avatarDefIds) {
      expect(avatarDefId).toBeGreaterThanOrEqual(1);
      expect(avatarDefId).toBeLessThan(100);
      expect(isAvatarDefId(avatarDefId)).toBe(true);
    }
    expect(avatarDefIds.length).toBeGreaterThanOrEqual(8);
    expect(isAvatarDefId(DefId.Tree)).toBe(false);
    expect(DefId.Tree).toBeGreaterThanOrEqual(200);
    expect(DefId.Tree).toBeLessThan(300);
    expect(getTileDef(DefId.Tree).solid).toBe(true);
    expect(() => getDef(999_999)).toThrow(/Unknown entity def/);
  });

  it('a new kind of tile is only a data entry: every terrain def resolves and has a placeholder colour', () => {
    for (const def of terrainDefs) {
      expect(getDef(def.id)).toBe(def);
      expect(def.color).toBeGreaterThanOrEqual(0);
      expect(def.color).toBeLessThanOrEqual(0xffffff);
      expect(typeof def.solid).toBe('boolean');
    }
    expect(terrainDefs.map((def) => def.name)).toEqual(expect.arrayContaining(['grass', 'dirt', 'tree', 'rock']));
  });

  it('terrain colliders come from level data, so a new obstacle is only a character in a row', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const colliders = sim.entityCount;
    const withRock = { ...starterLevel, rows: starterLevel.rows.map((row, index) => (index === starterLevel.spawn.row + 2 ? `${row.slice(0, 20)}o${row.slice(21)}` : row)) };
    const simWithRock = await createSimInternal({ seed: 1, level: withRock });
    expect(simWithRock.entityCount).toBe(colliders + 1);
    expect(getRenderables(sim)).toHaveLength(0);
    simWithRock.destroy();
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;
