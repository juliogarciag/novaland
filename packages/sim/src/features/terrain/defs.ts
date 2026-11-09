import type { EntityDef } from '../../content/defs';

/** Side of one tile in metres. The client turns it into pixels with PIXELS_PER_METRE. */
export const TILE_SIZE = 1;

/** A kind of tile. Solid tiles become static colliders; the rest is ground players walk on. */
export interface TileDef extends EntityDef {
  readonly solid: boolean;
}

/** Terrain feature owns def ids 200-299. */
export const TerrainDefId = {
  Grass: 200,
  Dirt: 201,
  Tree: 202,
  Rock: 203,
} as const;

/** Placeholder colours until there is art: flat, distinct per kind. */
export const terrainDefs: readonly TileDef[] = [
  { id: TerrainDefId.Grass, name: 'grass', shape: 'box', color: 0x5c9e4a, solid: false },
  { id: TerrainDefId.Dirt, name: 'dirt', shape: 'box', color: 0xb08d5b, solid: false },
  { id: TerrainDefId.Tree, name: 'tree', shape: 'box', color: 0x2f6b3a, solid: true },
  { id: TerrainDefId.Rock, name: 'rock', shape: 'box', color: 0x8a8f99, solid: true },
];

const tileDefsById: ReadonlyMap<number, TileDef> = new Map(terrainDefs.map((def) => [def.id, def]));

/** The tile def with this id. Throws for ids that are not tiles: a level legend pointing at one is a content bug. */
export function getTileDef(defId: number): TileDef {
  const def = tileDefsById.get(defId);
  if (!def) throw new Error(`Def id ${defId} is not a tile`);
  return def;
}
