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
  /** How many tiles the sheet holds side by side. */
  readonly variantCount: number;
}

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
} as const;

/**
 * `color` is the flat placeholder a view falls back to; dirt has nothing
 * else yet. The rest has art in the client's `sprites/` folder, each sheet
 * written by a generator in packages/client/tools whose frame size and
 * variant count must match the sprite declared here (a test next to each
 * generator checks it): `generate-grass-sheet.mjs` for grass,
 * `generate-tree-sheet.mjs` for the tree, `generate-rock-sheet.mjs` for the rock,
 * `generate-water-sheet.mjs` for water.
 *
 * Water is flat like grass and solid like a tree: it is drawn in the ground
 * and nobody walks on it. Its colour is far from every other tile's, so a
 * view that draws tiles by colour alone (a minimap) shows where the lakes are.
 */
export const terrainDefs: readonly TileDef[] = [
  { id: TerrainDefId.Grass, name: 'grass', shape: 'box', color: 0x5c9e4a, solid: false, groundSprite: { key: 'grass', tilePixels: 16, variantCount: 24 } },
  { id: TerrainDefId.Dirt, name: 'dirt', shape: 'box', color: 0xb08d5b, solid: false },
  {
    id: TerrainDefId.Tree,
    name: 'tree',
    shape: 'box',
    color: 0x2f6b3a,
    solid: true,
    standingSprite: { key: 'tree', frameWidth: 24, frameHeight: 32, pixelsPerMetre: 16, variantCount: 3, groundDefId: TerrainDefId.Grass },
  },
  {
    id: TerrainDefId.Rock,
    name: 'rock',
    shape: 'box',
    color: 0x8a8f99,
    solid: true,
    standingSprite: { key: 'rock', frameWidth: 16, frameHeight: 20, pixelsPerMetre: 16, variantCount: 4, groundDefId: TerrainDefId.Grass },
  },
  { id: TerrainDefId.Water, name: 'water', shape: 'box', color: 0x3e82d2, solid: true, groundSprite: { key: 'water', tilePixels: 16, variantCount: 8 } },
];

const tileDefsById: ReadonlyMap<number, TileDef> = new Map(terrainDefs.map((def) => [def.id, def]));

/** The tile def with this id. Throws for ids that are not tiles: an area's legend pointing at one is a content bug. */
export function getTileDef(defId: number): TileDef {
  const def = tileDefsById.get(defId);
  if (!def) throw new Error(`Def id ${defId} is not a tile`);
  return def;
}
