import { entityDefs, tileCentre, TILE_SIZE, WORLD_LIMIT_TILES, type EntityDef, type Landmark, type MinimapMarkerShape, type Renderable } from '@novaland/sim';

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
  /** Where to draw it: tiles east and south of the minimap's centre. Never further than `edgeTiles` on either axis. */
  readonly offset: { readonly x: number; readonly y: number };
  /** True when the thing is out of range: the mark sits on the minimap's edge, on the straight line toward the thing, and the view adds an arrow. */
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
  /** How far the minimap reaches from its centre, in tiles: a thing further than this on either axis is out of range. */
  readonly rangeTiles: number;
  /** The furthest from the centre a mark is drawn, in tiles: a little less than the range, so a mark and its arrow fit inside the minimap. */
  readonly edgeTiles: number;
}

/**
 * The most entities the minimap marks in one frame, the local player not
 * counted. Far more than the world's seats: it only stops a server that
 * sends tens of thousands of entities from costing a frame's worth of
 * drawing in a corner of the screen.
 */
export const MOST_ENTITY_MARKS = 256;

/**
 * What the minimap marks, in drawing order: landmarks at the bottom, then
 * the other entities, the local player on top. Whether and how a thing is
 * marked is its def's `minimap` (or the landmark's): nothing here knows what
 * a player or a starting point is. A thing out of range is put on the edge
 * or left out, as its marker says; a thing in range but past `edgeTiles` is
 * held at `edgeTiles` too, so a mark never jumps as its thing crosses the
 * range. Online, the frame comes from the server, so nothing in it is
 * trusted: a position that is not finite and a def id that is no def are
 * left out, and entity marks stop at `MOST_ENTITY_MARKS`.
 */
export function minimapMarks({ renderables, localEid, landmarks, centre, rangeTiles, edgeTiles }: MinimapMarksOptions): MinimapMark[] {
  const offsetOf = (position: { readonly x: number; readonly y: number }, beyondRange: 'edge' | 'hidden'): Pick<MinimapMark, 'offset' | 'onEdge'> | undefined => {
    const x = (position.x - centre.x) / TILE_SIZE;
    const y = (position.y - centre.y) / TILE_SIZE;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const furthestAxisTiles = Math.max(Math.abs(x), Math.abs(y));
    const onEdge = furthestAxisTiles > rangeTiles;
    if (onEdge && beyondRange === 'hidden') return undefined;
    if (furthestAxisTiles <= edgeTiles) return { offset: { x, y }, onEdge };
    return { offset: { x: (x / furthestAxisTiles) * edgeTiles, y: (y / furthestAxisTiles) * edgeTiles }, onEdge };
  };
  const landmarkMarks: MinimapMark[] = [];
  for (const landmark of landmarks) {
    const placed = offsetOf(tileCentre(landmark.tile), landmark.minimap.beyondRange);
    if (placed) landmarkMarks.push({ source: 'landmark', name: landmark.name, eid: undefined, isLocalPlayer: false, shape: landmark.minimap.shape, color: landmark.minimap.color, ...placed });
  }
  const otherMarks: MinimapMark[] = [];
  const localMarks: MinimapMark[] = [];
  for (const renderable of renderables) {
    const def = defById.get(renderable.defId);
    if (!def?.minimap) continue;
    const isLocalPlayer = renderable.eid === localEid;
    if (!isLocalPlayer && otherMarks.length >= MOST_ENTITY_MARKS) continue;
    const placed = offsetOf(renderable, def.minimap.beyondRange);
    if (!placed) continue;
    (isLocalPlayer ? localMarks : otherMarks).push({ source: 'entity', name: def.name, eid: renderable.eid, isLocalPlayer, shape: def.minimap.shape, color: def.minimap.color, ...placed });
  }
  return [...landmarkMarks, ...otherMarks, ...localMarks];
}

/**
 * The point of the world the minimap is centred on, in metres: where the
 * frame drew the local player, or `previous` when it drew none or drew them
 * somewhere no area can be (not finite, or past the world's limit).
 */
export function minimapCentre({ renderables, localEid, previous }: { renderables: readonly Renderable[]; localEid: number | undefined; previous: { readonly x: number; readonly y: number } }): { readonly x: number; readonly y: number } {
  const localPlayer = localEid === undefined ? undefined : renderables.find((renderable) => renderable.eid === localEid);
  if (!localPlayer) return previous;
  const limit = WORLD_LIMIT_TILES * TILE_SIZE;
  // NaN fails both comparisons.
  if (!(Math.abs(localPlayer.x) <= limit) || !(Math.abs(localPlayer.y) <= limit)) return previous;
  return { x: localPlayer.x, y: localPlayer.y };
}

/** `getDef` throws for an id that is no def; a frame is not allowed to stop the HUD. */
const defById: ReadonlyMap<number, EntityDef> = new Map(entityDefs.map((def) => [def.id, def]));
