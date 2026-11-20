import type { EntityDef } from '../../content/defs';

/** Side of one tile in metres. The client turns it into pixels with PIXELS_PER_METRE. */
export const TILE_SIZE = 1;

/**
 * A kind of tile. Solid tiles become static colliders; the rest is ground players walk on.
 * Solid says only that a player cannot be there: a tree stands up from the ground, water lies flat in it.
 */
export interface TileDef extends EntityDef {
  readonly solid: boolean;
  /**
   * Image to draw standing on the tile instead of the flat tile. Views fall back to `color` when absent.
   * Tiles are drawn from this, never from `sprite`, which is for entities that face and walk.
   */
  readonly standingSprite?: StandingTileSprite;
  /**
   * Texture to draw the flat tile with instead of filling it with `color`. Views fall back to `color` when absent.
   * A tile has this or `standingSprite`, never both: a standing tile's ground comes from its `groundDefId`.
   */
  readonly groundSprite?: GroundTileSprite;
}

/**
 * How views draw a flat tile that has a texture, such as grass. The sim
 * never reads any of this. The image is `sprites/<key>.png` in the client's
 * public folder: `variantCount` square tiles side by side, each the same
 * ground with its details in other places, so a field of them does not
 * repeat. Any variant must look right next to any other: views pick one per
 * tile and lay them edge to edge.
 */
export interface GroundTileSprite {
  /** Texture key, unique among every sprite key of every def: they share one folder and one texture namespace. */
  readonly key: string;
  /** Side of one tile of the sheet in texture pixels. */
  readonly tilePixels: number;
  /** How many variants the sheet holds side by side. */
  readonly variantCount: number;
  /**
   * Set for a surface that shows an edge where it ends, such as water at its
   * coast. The sheet then holds, after its variants, one more tile for every
   * shape in `EDGE_SHAPES`: the same ground with the edge drawn inside the
   * tile on the sides where the surface ends. A tile whose eight neighbours
   * are all the same surface shows a variant.
   */
  readonly edgeTiles?: {
    /** The defs that count as the same surface, this tile's own among them: no edge is drawn towards these. */
    readonly sameSurfaceDefIds: readonly number[];
  };
}

/**
 * The eight neighbours of a tile, each a bit of an edge shape: the bit is
 * set when that neighbour is the same surface as the tile.
 */
export const EdgeNeighbour = { North: 1, East: 2, South: 4, West: 8, NorthEast: 16, SouthEast: 32, SouthWest: 64, NorthWest: 128 } as const;

const ALL_EDGE_NEIGHBOURS = 255;

/**
 * The shape of a tile's edge for the neighbours in `sameSurfaceNeighbours`
 * (`EdgeNeighbour` bits). A diagonal neighbour only changes the look when
 * both tiles beside it are the same surface: otherwise the edge already runs
 * across that corner, so its bit is dropped and many neighbourhoods share one shape.
 */
export function edgeShapeOf(sameSurfaceNeighbours: number): number {
  const has = (bits: number) => (sameSurfaceNeighbours & bits) === bits;
  let shape = sameSurfaceNeighbours & (EdgeNeighbour.North | EdgeNeighbour.East | EdgeNeighbour.South | EdgeNeighbour.West);
  if (has(EdgeNeighbour.North | EdgeNeighbour.East | EdgeNeighbour.NorthEast)) shape |= EdgeNeighbour.NorthEast;
  if (has(EdgeNeighbour.South | EdgeNeighbour.East | EdgeNeighbour.SouthEast)) shape |= EdgeNeighbour.SouthEast;
  if (has(EdgeNeighbour.South | EdgeNeighbour.West | EdgeNeighbour.SouthWest)) shape |= EdgeNeighbour.SouthWest;
  if (has(EdgeNeighbour.North | EdgeNeighbour.West | EdgeNeighbour.NorthWest)) shape |= EdgeNeighbour.NorthWest;
  return shape;
}

/**
 * Every edge shape a tile can have, in the order a sheet with `edgeTiles`
 * holds them after its variants: 46 of them. The shape with all eight
 * neighbours the same surface is not here: that tile has no edge.
 */
export const EDGE_SHAPES: readonly number[] = [...new Set(Array.from({ length: ALL_EDGE_NEIGHBOURS + 1 }, (_, neighbours) => edgeShapeOf(neighbours)))]
  .filter((shape) => shape !== ALL_EDGE_NEIGHBOURS)
  .sort((first, second) => first - second);

/**
 * How views draw a tile that stands up from the ground and is taller or wider
 * than its tile, such as a tree or a rock. The sim never reads any of this: the tile is
 * still one square of `TILE_SIZE` metres to the physics. The image is
 * `sprites/<key>.png` in the client's public folder: `variantCount` frames side
 * by side, each showing the same thing a little differently so a block of
 * them does not repeat. A frame's bottom centre sits on the bottom centre of
 * the tile.
 */
export interface StandingTileSprite {
  /** Texture key, unique among every sprite key of every def: they share one folder and one texture namespace. */
  readonly key: string;
  /** Size of one frame in texture pixels. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Texture pixels per sim metre the image was drawn at. */
  readonly pixelsPerMetre: number;
  /** How many frames the sheet holds side by side. */
  readonly variantCount: number;
  /** The tile def drawn on the ground under the image. */
  readonly groundDefId: number;
}

/** Terrain feature owns def ids 200-299. */
export const TerrainDefId = {
  Grass: 200,
  Dirt: 201,
  Tree: 202,
  Rock: 203,
  Water: 204,
  Shallows: 205,
} as const;

/**
 * `color` is the flat placeholder a view falls back to; dirt has nothing
 * else yet. The rest has art in the client's `sprites/` folder, each sheet
 * written by a generator in packages/client/tools whose frame size and
 * variant count must match the sprite declared here (a test next to each
 * generator checks it): `generate-grass-sheet.mjs` for grass,
 * `generate-tree-sheet.mjs` for the tree, `generate-rock-sheet.mjs` for the rock,
 * `generate-water-sheet.mjs` for water and the shallows.
 *
 * A lake is two tiles, both flat like grass and solid like a tree: they
 * are drawn in the ground and nobody walks on them. Water is the deep
 * middle. The shallows are the ring between it and the land, and the coast
 * is drawn on them, a bank where they meet the land: a player stops at the
 * top of that bank. Both
 * blues are far from every other tile's colour, so a view that draws tiles
 * by colour alone (a minimap) shows where the lakes are.
 */
export const terrainDefs: readonly TileDef[] = [
  { id: TerrainDefId.Grass, name: 'grass', shape: 'box', color: 0x5c9e4a, solid: false, groundSprite: { key: 'grass', tilePixels: 32, variantCount: 24 } },
  { id: TerrainDefId.Dirt, name: 'dirt', shape: 'box', color: 0xb08d5b, solid: false },
  {
    id: TerrainDefId.Tree,
    name: 'tree',
    shape: 'box',
    color: 0x2f6b3a,
    solid: true,
    standingSprite: { key: 'tree', frameWidth: 48, frameHeight: 64, pixelsPerMetre: 32, variantCount: 8, groundDefId: TerrainDefId.Grass },
  },
  {
    id: TerrainDefId.Rock,
    name: 'rock',
    shape: 'box',
    color: 0x8a8f99,
    solid: true,
    standingSprite: { key: 'rock', frameWidth: 32, frameHeight: 40, pixelsPerMetre: 32, variantCount: 4, groundDefId: TerrainDefId.Grass },
  },
  {
    id: TerrainDefId.Water,
    name: 'water',
    shape: 'box',
    color: 0x3e82d2,
    solid: true,
    groundSprite: { key: 'water', tilePixels: 32, variantCount: 8, edgeTiles: { sameSurfaceDefIds: [TerrainDefId.Water] } },
  },
  {
    id: TerrainDefId.Shallows,
    name: 'shallows',
    shape: 'box',
    color: 0x74b8ea,
    solid: true,
    groundSprite: { key: 'shallows', tilePixels: 32, variantCount: 8, edgeTiles: { sameSurfaceDefIds: [TerrainDefId.Shallows, TerrainDefId.Water] } },
  },
];

const tileDefsById: ReadonlyMap<number, TileDef> = new Map(terrainDefs.map((def) => [def.id, def]));

/** The tile def with this id. Throws for ids that are not tiles: an area's legend pointing at one is a content bug. */
export function getTileDef(defId: number): TileDef {
  const def = tileDefsById.get(defId);
  if (!def) throw new Error(`Def id ${defId} is not a tile`);
  return def;
}
