import { getDef, tileCentre, TILE_SIZE, type Landmark, type MinimapMarker, type MinimapMarkerShape, type Renderable } from '@novaland/sim';

/** One marker to draw on the minimap. */
export interface MinimapMark {
  /** An entity of the frame, or a fixed place of the map. */
  readonly source: 'entity' | 'landmark';
  /** The def's name or the landmark's. */
  readonly name: string;
  /** The entity's id; undefined for a landmark. */
  readonly eid: number | undefined;
  /** True for the player at this keyboard: the view draws that one differently. */
  readonly isLocalPlayer: boolean;
  readonly shape: MinimapMarkerShape;
  /** 0xRRGGBB. */
  readonly color: number;
  /** Where to draw it: tiles east and south of the minimap's centre. */
  readonly offset: { readonly x: number; readonly y: number };
  /** True when the thing is out of range and the mark sits on the minimap's edge instead, on the straight line toward the thing. */
  readonly onEdge: boolean;
}

export interface MinimapMarksOptions {
  /** What the frame draws, at the positions it draws them (online, the local player's is predicted). */
  readonly renderables: readonly Renderable[];
  /** The entity of the player at this keyboard, when it has one. */
  readonly localEid: number | undefined;
  readonly landmarks: readonly Landmark[];
  /** The point of the world at the minimap's centre, in metres. */
  readonly centre: { readonly x: number; readonly y: number };
  /** How far the minimap reaches from its centre, in tiles: a thing within this on both axes is drawn where it is. */
  readonly rangeTiles: number;
  /** How far from the centre an out-of-range mark is drawn, in tiles: less than the range, so the mark and its arrow fit inside. */
  readonly edgeTiles: number;
}

/**
 * What the minimap marks, in drawing order: landmarks at the bottom, then
 * the other entities, the local player on top. Whether and how a thing is
 * marked is its def's `minimap` (or the landmark's): nothing here knows what
 * a player or a starting point is. A thing out of range is put on the edge
 * or left out, as its marker says. A position that is not finite is left
 * out: online, positions come from the server.
 */
export function minimapMarks({ renderables, localEid, landmarks, centre, rangeTiles, edgeTiles }: MinimapMarksOptions): MinimapMark[] {
  const place = (marker: MinimapMarker, position: { readonly x: number; readonly y: number }): Pick<MinimapMark, 'offset' | 'onEdge'> | undefined => {
    const x = (position.x - centre.x) / TILE_SIZE;
    const y = (position.y - centre.y) / TILE_SIZE;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const furthest = Math.max(Math.abs(x), Math.abs(y));
    if (furthest <= rangeTiles) return { offset: { x, y }, onEdge: false };
    if (marker.beyondRange === 'hidden') return undefined;
    return { offset: { x: (x / furthest) * edgeTiles, y: (y / furthest) * edgeTiles }, onEdge: true };
  };
  const landmarkMarks: MinimapMark[] = [];
  for (const landmark of landmarks) {
    const placed = place(landmark.minimap, tileCentre(landmark.tile));
    if (placed) landmarkMarks.push({ source: 'landmark', name: landmark.name, eid: undefined, isLocalPlayer: false, shape: landmark.minimap.shape, color: landmark.minimap.color, ...placed });
  }
  const otherMarks: MinimapMark[] = [];
  const localMarks: MinimapMark[] = [];
  for (const renderable of renderables) {
    const def = getDef(renderable.defId);
    if (!def.minimap) continue;
    const placed = place(def.minimap, renderable);
    if (!placed) continue;
    const isLocalPlayer = renderable.eid === localEid;
    (isLocalPlayer ? localMarks : otherMarks).push({ source: 'entity', name: def.name, eid: renderable.eid, isLocalPlayer, shape: def.minimap.shape, color: def.minimap.color, ...placed });
  }
  return [...landmarkMarks, ...otherMarks, ...localMarks];
}
