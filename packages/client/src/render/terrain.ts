import { readTileGrid, terrainDefs, tileCentre, TILE_SIZE, type GroundTileSprite, type LevelData, type StandingTileSprite } from '@novaland/sim';
import Phaser from 'phaser';
import { GROUND_TILE_PIXELS, groundTileIndexRows, groundTilesetSlots, type GroundTilesetSlot } from './groundTiles';
import { spriteSheetUrl } from './sprites';
import { standingTilePlacements } from './standingTiles';
import { PIXELS_PER_METRE, toPixels } from './units';

const TILESET_TEXTURE_KEY = 'terrain-ground-tiles';
const TILESET_NAME = 'terrain';

/**
 * Draws below every entity. Entities are depth-sorted by their bottom edge in
 * pixels (render/entities.ts), which is negative north of the level centre, so
 * the ground has to sit below any pixel coordinate, not just below zero.
 */
const TERRAIN_DEPTH = Number.MIN_SAFE_INTEGER;

/** Queues the sheet of every terrain def that has art: ground textures and standing images. Call from a scene's `preload`. */
export function loadTerrainSprites(scene: Phaser.Scene): void {
  for (const sprite of groundTileSprites()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.tilePixels, frameHeight: sprite.tilePixels });
  }
  for (const sprite of standingTileSprites()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight });
  }
}

/**
 * Draws a level from the same level data the sim builds its colliders from,
 * in two parts.
 *
 * The ground is a Phaser tilemap below everything. Its tileset is put
 * together here (render/groundTiles.ts says which tile is where): a def
 * with a `groundSprite` (grass) brings the variants of its sheet and each
 * tile of the level shows the one its column and row pick; any other def
 * is one flat tile in its colour.
 *
 * A def with a `standingSprite` (a tree, a rock) is one image per tile on
 * top of that, standing on the tile's bottom edge and depth-sorted among
 * the entities by it, with the def's ground tile under it.
 *
 * A sheet that failed to load is not fatal: its def is drawn flat in its
 * own colour instead.
 */
export function drawTerrain(scene: Phaser.Scene, level: LevelData): Phaser.Tilemaps.TilemapLayer {
  const grid = readTileGrid(level);
  const isTextureLoaded = (key: string): boolean => scene.textures.exists(key);
  for (const sprite of standingTileSprites()) {
    if (isTextureLoaded(sprite.key)) scene.textures.get(sprite.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  const slots = groundTilesetSlots(terrainDefs, isTextureLoaded);
  buildGroundTileset(scene, slots);
  const tileIndexRows = groundTileIndexRows({ grid, slots, isStandingImageDrawn: (sprite) => isTextureLoaded(sprite.key) });
  const tilemap = scene.make.tilemap({ data: tileIndexRows, tileWidth: GROUND_TILE_PIXELS, tileHeight: GROUND_TILE_PIXELS });
  const tileset = tilemap.addTilesetImage(TILESET_NAME, TILESET_TEXTURE_KEY, GROUND_TILE_PIXELS, GROUND_TILE_PIXELS, 0, 0);
  if (!tileset) throw new Error('The terrain tileset texture is missing');
  // The sim decides where tiles are; the layer's corner is the top-left tile's centre minus half a tile.
  const firstTileCentre = tileCentre(grid, { column: 0, row: 0 });
  const layer = tilemap.createLayer(0, tileset, toPixels(firstTileCentre.x - grid.tileSize / 2), toPixels(firstTileCentre.y - grid.tileSize / 2));
  if (!layer) throw new Error('Could not create the terrain layer');
  layer.setScale(toPixels(TILE_SIZE) / GROUND_TILE_PIXELS);
  layer.setDepth(TERRAIN_DEPTH);
  for (const placement of standingTilePlacements(grid)) {
    if (!isTextureLoaded(placement.sprite.key)) continue;
    const image = scene.add.image(placement.x, placement.y, placement.sprite.key, placement.frame);
    image.setOrigin(0.5, 1);
    image.setScale(PIXELS_PER_METRE / placement.sprite.pixelsPerMetre);
    image.setDepth(placement.depth);
  }
  return layer as Phaser.Tilemaps.TilemapLayer;
}

/** The ground sprite of every terrain def that has one, in def order. */
function groundTileSprites(): GroundTileSprite[] {
  return terrainDefs.flatMap((def) => (def.groundSprite ? [def.groundSprite] : []));
}

/** The standing sprite of every terrain def that has one, in def order. */
function standingTileSprites(): StandingTileSprite[] {
  return terrainDefs.flatMap((def) => (def.standingSprite ? [def.standingSprite] : []));
}

/**
 * The ground tileset: one strip with the tiles of every slot in order. A
 * slot with a ground sprite gets the tiles of its sheet copied in; any
 * other gets one flat-colour tile, with a darker rim when the def is solid
 * so that a tree or rock whose image is missing still reads as an object.
 */
function buildGroundTileset(scene: Phaser.Scene, slots: readonly GroundTilesetSlot[]): void {
  // Built again on every draw: the slots depend on which sheets loaded, and a strip from an earlier draw may be laid out differently.
  if (scene.textures.exists(TILESET_TEXTURE_KEY)) scene.textures.remove(TILESET_TEXTURE_KEY);
  const tileCount = slots.reduce((count, slot) => count + slot.tileCount, 0);
  const tileset = scene.textures.createCanvas(TILESET_TEXTURE_KEY, GROUND_TILE_PIXELS * tileCount, GROUND_TILE_PIXELS);
  if (!tileset) throw new Error('Could not create the terrain tileset texture');
  const context = tileset.getContext();
  for (const slot of slots) {
    const slotLeft = slot.firstTileIndex * GROUND_TILE_PIXELS;
    if (slot.groundSprite) {
      for (let variant = 0; variant < slot.tileCount; variant += 1) tileset.drawFrame(slot.groundSprite.key, variant, slotLeft + variant * GROUND_TILE_PIXELS, 0, false);
      continue;
    }
    context.fillStyle = cssColor(slot.def.color);
    context.fillRect(slotLeft, 0, GROUND_TILE_PIXELS, GROUND_TILE_PIXELS);
    if (slot.def.solid) {
      context.strokeStyle = cssColor(darken(slot.def.color));
      context.lineWidth = 1;
      context.strokeRect(slotLeft + 0.5, 0.5, GROUND_TILE_PIXELS - 1, GROUND_TILE_PIXELS - 1);
    }
  }
  tileset.refresh();
  // Scaled up with linear filtering, tile edges would bleed into their neighbours in the strip.
  tileset.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function darken(color: number): number {
  const channel = (shift: number) => Math.floor(((color >> shift) & 0xff) * 0.7) << shift;
  return channel(16) | channel(8) | channel(0);
}
