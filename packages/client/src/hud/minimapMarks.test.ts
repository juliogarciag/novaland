import { avatarDefIds, createSim, findPlayerEntity, getDef, getRenderables, mapLandmarks, tileCentre, TILE_SIZE, worldMap, type Landmark, type Renderable } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { minimapMarks, type MinimapMarksOptions } from './minimapMarks';

describe('minimapMarks', () => {
  it('marks the starting point, the other players and the local player, in that drawing order, each where it is', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([
      { type: 'player/join', slot: 0 },
      { type: 'player/join', slot: 1 },
    ]);
    const renderables = getRenderables(sim);
    const localEid = findPlayerEntity(sim, 0) as number;
    const local = renderables.find((renderable) => renderable.eid === localEid) as Renderable;
    const other = renderables.find((renderable) => renderable.eid !== localEid) as Renderable;
    const marks = minimapMarks({ ...NEARBY, renderables, localEid, landmarks: mapLandmarks(worldMap), centre: local });
    const spawn = tileCentre(worldMap.spawn);
    expect(marks).toEqual([
      { source: 'landmark', name: 'starting point', eid: undefined, isLocalPlayer: false, shape: 'diamond', color: mapLandmarks(worldMap)[0]?.minimap.color, offset: { x: (spawn.x - local.x) / TILE_SIZE, y: (spawn.y - local.y) / TILE_SIZE }, onEdge: false },
      { source: 'entity', name: getDef(other.defId).name, eid: other.eid, isLocalPlayer: false, shape: 'dot', color: getDef(other.defId).color, offset: { x: (other.x - local.x) / TILE_SIZE, y: (other.y - local.y) / TILE_SIZE }, onEdge: false },
      { source: 'entity', name: getDef(local.defId).name, eid: localEid, isLocalPlayer: true, shape: 'dot', color: getDef(local.defId).color, offset: { x: 0, y: 0 }, onEdge: false },
    ]);
  });

  it('puts a thing that is out of range on the edge, on the straight line toward it', () => {
    const [mark] = minimapMarks({ ...NEARBY, landmarks: [landmarkAt({ column: -200, row: 100 })], centre: tileCentre({ column: 0, row: 0 }) });
    expect(mark).toMatchObject({ onEdge: true, offset: { x: -EDGE_TILES, y: EDGE_TILES / 2 } });
    for (const [tile, offset] of [
      [{ column: 41, row: 0 }, { x: EDGE_TILES, y: 0 }],
      [{ column: 0, row: -500 }, { x: 0, y: -EDGE_TILES }],
      [{ column: 300, row: 300 }, { x: EDGE_TILES, y: EDGE_TILES }],
    ] as const) {
      expect(minimapMarks({ ...NEARBY, landmarks: [landmarkAt(tile)], centre: tileCentre({ column: 0, row: 0 }) })[0], JSON.stringify(tile)).toMatchObject({ onEdge: true, offset });
    }
  });

  it('draws a thing where it is up to the very edge of the range, on both axes', () => {
    const centre = tileCentre({ column: 10, row: 10 });
    expect(minimapMarks({ ...NEARBY, landmarks: [landmarkAt({ column: 10 + RANGE_TILES, row: 10 - RANGE_TILES })], centre })[0]).toMatchObject({ onEdge: false, offset: { x: RANGE_TILES, y: -RANGE_TILES } });
    expect(minimapMarks({ ...NEARBY, landmarks: [landmarkAt({ column: 10 + RANGE_TILES + 1, row: 10 })], centre })[0]).toMatchObject({ onEdge: true });
  });

  it('leaves out a far thing whose marker says hidden, and shows it again once in range', () => {
    const coin = landmarkAt({ column: 100, row: 0 }, 'hidden');
    expect(minimapMarks({ ...NEARBY, landmarks: [coin], centre: tileCentre({ column: 0, row: 0 }) })).toEqual([]);
    expect(minimapMarks({ ...NEARBY, landmarks: [coin], centre: tileCentre({ column: 90, row: 0 }) })).toMatchObject([{ onEdge: false, offset: { x: 10, y: 0 } }]);
  });

  it('marks a far player on the edge too, in the colour of its avatar', () => {
    const defId = avatarDefIds[3] as number;
    const marks = minimapMarks({ ...NEARBY, renderables: [{ eid: 7, defId, x: 0.5, y: 300.5, halfWidth: 0.4, halfHeight: 0.4 }], localEid: 2, centre: { x: 0.5, y: 0.5 } });
    expect(marks).toEqual([{ source: 'entity', name: getDef(defId).name, eid: 7, isLocalPlayer: false, shape: 'dot', color: getDef(defId).color, offset: { x: 0, y: EDGE_TILES }, onEdge: true }]);
  });

  it('leaves out a position that is not finite instead of drawing it somewhere: positions come from the server', () => {
    const defId = avatarDefIds[0] as number;
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(minimapMarks({ ...NEARBY, renderables: [{ eid: 1, defId, x, y: 0, halfWidth: 0.4, halfHeight: 0.4 }], centre: { x: 0, y: 0 } }), String(x)).toEqual([]);
    }
  });
});

// ---- Helpers ----

const RANGE_TILES = 40;
const EDGE_TILES = 34;
/** A minimap with nothing on it: each test adds what it is about. */
const NEARBY: MinimapMarksOptions = { renderables: [], localEid: undefined, landmarks: [], centre: { x: 0, y: 0 }, rangeTiles: RANGE_TILES, edgeTiles: EDGE_TILES };

function landmarkAt(tile: { column: number; row: number }, beyondRange: 'edge' | 'hidden' = 'edge'): Landmark {
  return { name: 'somewhere', tile, minimap: { shape: 'diamond', color: 0x123456, beyondRange } };
}
