import { describe, expect, it } from 'vitest';
import { entityDefs } from '../defs';
import { avatarDefIds } from '../../features/player/defs';
import { generatedWorldMap } from './generated';
import { worldMap } from './index';
import { mapLandmarks } from './landmarks';

describe('what the minimap is told to mark', () => {
  it('lists the starting point of a map as a landmark on its spawn tile, kept on the edge when out of range', () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 400, rows: 300 })]) {
      expect(mapLandmarks(map)).toEqual([{ name: 'starting point', tile: map.spawn, minimap: { shape: 'diamond', color: expect.any(Number), beyondRange: 'edge' } }]);
    }
  });

  it('tells the starting point apart from every avatar by shape and by colour', () => {
    const [startingPoint] = mapLandmarks(worldMap);
    for (const def of entityDefs.filter((candidate) => avatarDefIds.includes(candidate.id))) {
      if (!def.minimap) throw new Error(`${def.name} has no minimap marker`);
      expect(def.minimap.shape, def.name).not.toBe(startingPoint?.minimap.shape);
      expect(def.minimap.color, def.name).not.toBe(startingPoint?.minimap.color);
    }
  });
});
