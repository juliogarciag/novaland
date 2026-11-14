import { getTileDef, readTileGrid, terrainDefs, tileCentre, TILE_SIZE, type LevelData, type StandingTileSprite } from '@novaland/sim';
import Phaser from 'phaser';
import { spriteSheetUrl } from './sprites';
import { standingTilePlacements } from './standingTiles';
import { PIXELS_PER_METRE, toPixels } from './units';

/** Side of a generated placeholder tile in texture pixels. The layer is scaled up to TILE_SIZE metres on screen. */
export const PLACEHOLDER_TILE_PIXELS = 16;

const TILESET_TEXTURE_KEY = 'terrain-placeholder-tiles';
const TILESET_NAME = 'terrain';

/**
 * Draws below every entity. Entities are depth-sorted by their bottom edge in
 * pixels (render/entities.ts), which is negative north of the level centre, so
 * the ground has to sit below any pixel coordinate, not just below zero.
 */
const TERRAIN_DEPTH = Number.MIN_SAFE_INTEGER;

/** Queues the image of every terrain def that stands up from the ground. Call from a scene's `preload`. */
export function loadStandingTileSprites(scene: Phaser.Scene): void {
  for (const sprite of standingTileSprites()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight });
  }
}

/**
 * Draws a level from the same level data the sim builds its colliders from,
 * in two parts.
 *
 * The ground is a Phaser tilemap below everything. Its tileset is generated
 * here until there is art: one flat-colour 16x16 tile per terrain def, in
 * the order of `terrainDefs`, so the tile index of a def is its position in
 * that list.
 *
 * A def with a `standingSprite` (a tree) is one image per tile on top of
 * that, standing on the tile's bottom edge and depth-sorted among the
 * entities by it, with the def's ground tile under it. If the image failed
 * to load, the tile is drawn flat in the def's own colour instead.
 */
export function drawTerrain(scene: Phaser.Scene, level: LevelData): Phaser.Tilemaps.TilemapLayer {
  const grid = readTileGrid(level);
  ensurePlaceholderTileset(scene);
  const loadedStandingSprites = standingTileSprites().filter((sprite) => scene.textures.exists(sprite.key));
  for (const sprite of loadedStandingSprites) scene.textures.get(sprite.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const tileIndexByDefId = new Map(terrainDefs.map((def, index) => [def.id, index]));
  const groundTileIndex = (defId: number): number => {
    const sprite = getTileDef(defId).standingSprite;
    const groundDefId = sprite && loadedStandingSprites.includes(sprite) ? sprite.groundDefId : defId;
    return tileIndexByDefId.get(groundDefId) ?? 0;
  };
  const tileIndexRows = grid.defIds.map((row) => row.map(groundTileIndex));
  const tilemap = scene.make.tilemap({ data: tileIndexRows, tileWidth: PLACEHOLDER_TILE_PIXELS, tileHeight: PLACEHOLDER_TILE_PIXELS });
  const tileset = tilemap.addTilesetImage(TILESET_NAME, TILESET_TEXTURE_KEY, PLACEHOLDER_TILE_PIXELS, PLACEHOLDER_TILE_PIXELS, 0, 0);
  if (!tileset) throw new Error('The terrain tileset texture is missing');
  // The sim decides where tiles are; the layer's corner is the top-left tile's centre minus half a tile.
  const firstTileCentre = tileCentre(grid, { column: 0, row: 0 });
  const layer = tilemap.createLayer(0, tileset, toPixels(firstTileCentre.x - grid.tileSize / 2), toPixels(firstTileCentre.y - grid.tileSize / 2));
  if (!layer) throw new Error('Could not create the terrain layer');
  layer.setScale(toPixels(TILE_SIZE) / PLACEHOLDER_TILE_PIXELS);
  layer.setDepth(TERRAIN_DEPTH);
  for (const placement of standingTilePlacements(grid)) {
    if (!loadedStandingSprites.includes(placement.sprite)) continue;
    const image = scene.add.image(placement.x, placement.y, placement.sprite.key, placement.frame);
    image.setOrigin(0.5, 1);
    image.setScale(PIXELS_PER_METRE / placement.sprite.pixelsPerMetre);
    image.setDepth(placement.depth);
  }
  return layer as Phaser.Tilemaps.TilemapLayer;
}

/** The standing sprite of every terrain def that has one, in def order. */
function standingTileSprites(): StandingTileSprite[] {
  return terrainDefs.flatMap((def) => (def.standingSprite ? [def.standingSprite] : []));
}

/** A strip of flat-colour tiles, one per terrain def. Solid tiles get a darker rim so single trees and rocks read as objects. */
function ensurePlaceholderTileset(scene: Phaser.Scene): void {
  if (scene.textures.exists(TILESET_TEXTURE_KEY)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  terrainDefs.forEach((def, index) => {
    const x = index * PLACEHOLDER_TILE_PIXELS;
    graphics.fillStyle(def.color, 1);
    graphics.fillRect(x, 0, PLACEHOLDER_TILE_PIXELS, PLACEHOLDER_TILE_PIXELS);
    if (def.solid) {
      graphics.lineStyle(1, darken(def.color), 1);
      graphics.strokeRect(x + 0.5, 0.5, PLACEHOLDER_TILE_PIXELS - 1, PLACEHOLDER_TILE_PIXELS - 1);
    }
  });
  graphics.generateTexture(TILESET_TEXTURE_KEY, PLACEHOLDER_TILE_PIXELS * terrainDefs.length, PLACEHOLDER_TILE_PIXELS);
  graphics.destroy();
  // Scaled up 2x with linear filtering, tile edges would bleed into their neighbours in the strip.
  scene.textures.get(TILESET_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function darken(color: number): number {
  const channel = (shift: number) => Math.floor(((color >> shift) & 0xff) * 0.7) << shift;
  return channel(16) | channel(8) | channel(0);
}
