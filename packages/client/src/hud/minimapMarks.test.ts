import { characterPalettes, createSim, DefId, findPlayerEntity, getCharacter, getDef, guestCharacter, getRenderables, mapLandmarks, tileCentre, TILE_SIZE, WORLD_LIMIT_TILES, worldMap, type Character, type Landmark, type Renderable } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { minimapCentre, minimapMarks, MOST_ENTITY_MARKS, type MinimapMarksOptions } from './minimapMarks';

describe('minimapMarks', () => {
  it('marks the starting point, the other players and the local player, in that drawing order, each where it is', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([
      { type: 'player/join', slot: 0, character: guestCharacter(0) },
      { type: 'player/join', slot: 1, character: guestCharacter(1) },
    ]);
    const renderables = getRenderables(sim);
    const localEid = findPlayerEntity(sim, 0) as number;
    const local = renderables.find((renderable) => renderable.eid === localEid) as Renderable;
    const other = renderables.find((renderable) => renderable.eid !== localEid) as Renderable;
    const characters = new Map(renderables.flatMap((renderable) => { const character = getCharacter(sim, renderable.eid); return character ? [[renderable.eid, character] as const] : []; }));
    const marks = minimapMarks({ ...NEARBY, renderables, characters, localEid, landmarks: mapLandmarks(worldMap), centre: local });
    const spawn = tileCentre(worldMap.spawn);
    expect(marks).toEqual([
      { source: 'landmark', name: 'starting point', eid: undefined, isLocalPlayer: false, shape: 'diamond', color: mapLandmarks(worldMap)[0]?.minimap.color, offset: { x: (spawn.x - local.x) / TILE_SIZE, y: (spawn.y - local.y) / TILE_SIZE }, onEdge: false },
      { source: 'entity', name: getDef(other.defId).name, eid: other.eid, isLocalPlayer: false, shape: 'dot', color: clothesColor(guestCharacter(1)), offset: { x: (other.x - local.x) / TILE_SIZE, y: (other.y - local.y) / TILE_SIZE }, onEdge: false },
      { source: 'entity', name: getDef(local.defId).name, eid: localEid, isLocalPlayer: true, shape: 'dot', color: clothesColor(guestCharacter(0)), offset: { x: 0, y: 0 }, onEdge: false },
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

  it('never jumps: a thing walking out of range slides to the edge distance, stays there, and only gains its arrow past the range', () => {
    const centre = tileCentre({ column: 10, row: 10 });
    const markAt = (tilesEast: number) => minimapMarks({ ...NEARBY, landmarks: [landmarkAt({ column: 10 + tilesEast, row: 10 })], centre })[0];
    expect(markAt(EDGE_TILES)).toMatchObject({ onEdge: false, offset: { x: EDGE_TILES, y: 0 } });
    expect(markAt(EDGE_TILES + 3)).toMatchObject({ onEdge: false, offset: { x: EDGE_TILES, y: 0 } });
    expect(markAt(RANGE_TILES)).toMatchObject({ onEdge: false, offset: { x: EDGE_TILES, y: 0 } });
    expect(markAt(RANGE_TILES + 1)).toMatchObject({ onEdge: true, offset: { x: EDGE_TILES, y: 0 } });
    expect(minimapMarks({ ...NEARBY, landmarks: [landmarkAt({ column: 10 + RANGE_TILES, row: 10 - RANGE_TILES })], centre })[0]).toMatchObject({ onEdge: false, offset: { x: EDGE_TILES, y: -EDGE_TILES } });
  });

  it('leaves out a far thing whose marker says hidden, and shows it again once in range', () => {
    const coin = landmarkAt({ column: 100, row: 0 }, 'hidden');
    expect(minimapMarks({ ...NEARBY, landmarks: [coin], centre: tileCentre({ column: 0, row: 0 }) })).toEqual([]);
    expect(minimapMarks({ ...NEARBY, landmarks: [coin], centre: tileCentre({ column: 90, row: 0 }) })).toMatchObject([{ onEdge: false, offset: { x: 10, y: 0 } }]);
  });

  it('marks a far player on the edge too, in the colour of the clothes its character wears', () => {
    const defId = DefId.Player;
    const character = guestCharacter(3);
    const marks = minimapMarks({ ...NEARBY, renderables: [{ eid: 7, defId, x: 0.5, y: 300.5, halfWidth: 0.4, halfHeight: 0.4 }], characters: new Map([[7, character]]), localEid: 2, centre: { x: 0.5, y: 0.5 } });
    expect(marks).toEqual([{ source: 'entity', name: getDef(defId).name, eid: 7, isLocalPlayer: false, shape: 'dot', color: clothesColor(character), offset: { x: 0, y: EDGE_TILES }, onEdge: true }]);
    expect(new Set([0, 1, 2, 3].map((slot) => clothesColor(guestCharacter(slot)))).size).toBe(4);
  });

  it('marks a player whose character is not in the frame, or wears a swatch that is none, in its marker\'s own colour', () => {
    const renderables = [{ eid: 7, defId: DefId.Player, x: 3.5, y: 0.5, halfWidth: 0.4, halfHeight: 0.4 }];
    const ownColor = getDef(DefId.Player).minimap?.color;
    expect(minimapMarks({ ...NEARBY, renderables })[0]).toMatchObject({ color: ownColor });
    for (const clothes of [-1, 99, 1.5, Number.NaN]) {
      expect(minimapMarks({ ...NEARBY, renderables, characters: new Map([[7, { name: 'x', look: { skin: 0, hair: 0, clothes } }]]) })[0], String(clothes)).toMatchObject({ color: ownColor });
    }
  });

  it('leaves out a position that is not finite instead of drawing it somewhere: positions come from the server', () => {
    const defId = DefId.Player;
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(minimapMarks({ ...NEARBY, renderables: [{ eid: 1, defId, x, y: 0, halfWidth: 0.4, halfHeight: 0.4 }], centre: { x: 0, y: 0 } }), String(x)).toEqual([]);
    }
  });

  it('leaves out a def id that is no def or has no marker instead of throwing', () => {
    for (const defId of [0, -1, 1.5, 99_999, Number.NaN, DefId.Tree]) {
      expect(minimapMarks({ ...NEARBY, renderables: [{ eid: 1, defId, x: 0, y: 0, halfWidth: 0.4, halfHeight: 0.4 }] }), String(defId)).toEqual([]);
    }
  });

  it('stops at MOST_ENTITY_MARKS entities however many a frame holds, and still marks the local player', () => {
    const defId = DefId.Player;
    const renderables = Array.from({ length: 5000 }, (_, index) => ({ eid: index + 1, defId, x: index % 50, y: 0, halfWidth: 0.4, halfHeight: 0.4 }));
    const marks = minimapMarks({ ...NEARBY, renderables, localEid: 5000 });
    expect(marks).toHaveLength(MOST_ENTITY_MARKS + 1);
    expect(marks.at(-1)).toMatchObject({ eid: 5000, isLocalPlayer: true });
  });
});

describe('minimapCentre', () => {
  it('is where the frame drew the local player', () => {
    expect(minimapCentre({ renderables: [player(3, 12.25, -7.5), player(4, 1, 1)], localEid: 3, previous: { x: 0, y: 0 } })).toEqual({ x: 12.25, y: -7.5 });
  });

  it('stays where it was without a local player: none seated yet, or not in the frame', () => {
    const previous = { x: 6.5, y: 14.5 };
    expect(minimapCentre({ renderables: [player(4, 1, 1)], localEid: undefined, previous })).toBe(previous);
    expect(minimapCentre({ renderables: [player(4, 1, 1)], localEid: 3, previous })).toBe(previous);
    expect(minimapCentre({ renderables: [], localEid: 3, previous })).toBe(previous);
  });

  it('stays where it was for a position no area can be at: not finite, or past the world\'s limit', () => {
    const previous = { x: 6.5, y: 14.5 };
    const limit = WORLD_LIMIT_TILES * TILE_SIZE;
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, -Number.MAX_VALUE, limit + 1]) {
      expect(minimapCentre({ renderables: [player(3, x, 0)], localEid: 3, previous }), String(x)).toBe(previous);
      expect(minimapCentre({ renderables: [player(3, 0, x)], localEid: 3, previous }), String(x)).toBe(previous);
    }
    expect(minimapCentre({ renderables: [player(3, limit, -limit)], localEid: 3, previous })).toEqual({ x: limit, y: -limit });
  });
});

// ---- Helpers ----

const RANGE_TILES = 40;
const EDGE_TILES = 34;
/** A minimap with nothing on it: each test adds what it is about. */
const NEARBY: MinimapMarksOptions = { renderables: [], characters: new Map(), localEid: undefined, landmarks: [], centre: { x: 0, y: 0 }, rangeTiles: RANGE_TILES, edgeTiles: EDGE_TILES };

function clothesColor(character: Character): number {
  return characterPalettes.clothes[character.look.clothes]?.color as number;
}

function landmarkAt(tile: { column: number; row: number }, beyondRange: 'edge' | 'hidden' = 'edge'): Landmark {
  return { name: 'somewhere', tile, minimap: { shape: 'diamond', color: 0x123456, beyondRange } };
}

function player(eid: number, x: number, y: number): Renderable {
  return { eid, defId: DefId.Player, x, y, halfWidth: 0.4, halfHeight: 0.4 };
}
