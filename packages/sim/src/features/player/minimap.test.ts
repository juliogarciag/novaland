import { describe, expect, it } from 'vitest';
import { terrainDefs } from '../terrain/defs';
import { playerDefs } from './defs';

describe('players on the minimap', () => {
  it('marks every avatar as a dot in its own colour, kept on the edge when far, and no tile: tiles are painted, not marked', () => {
    for (const def of playerDefs) expect(def.minimap, def.name).toEqual({ shape: 'dot', color: def.color, beyondRange: 'edge' });
    for (const def of terrainDefs) expect(def.minimap, def.name).toBeUndefined();
  });
});
