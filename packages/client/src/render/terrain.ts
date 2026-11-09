import { readTileGrid, terrainDefs, tileCentre, TILE_SIZE, type LevelData } from '@novaland/sim';
import Phaser from 'phaser';
import { toPixels } from './units';

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

/**
 * Draws a level as a Phaser tilemap from the same level data the sim builds
 * its colliders from. Until there is art, the tileset is generated here: one
 * flat-colour 16x16 tile per terrain def, in the order of `terrainDefs`, so
 * the tile index of a cell is the position of its def in that list.
 */
export function drawTerrain(scene: Phaser.Scene, level: LevelData): Phaser.Tilemaps.TilemapLayer {
  const grid = readTileGrid(level);
  ensurePlaceholderTileset(scene);
  const tileIndexByDefId = new Map(terrainDefs.map((def, index) => [def.id, index]));
  const tileIndexRows = grid.defIds.map((row) => row.map((defId) => tileIndexByDefId.get(defId) ?? 0));
  const tilemap = scene.make.tilemap({ data: tileIndexRows, tileWidth: PLACEHOLDER_TILE_PIXELS, tileHeight: PLACEHOLDER_TILE_PIXELS });
  const tileset = tilemap.addTilesetImage(TILESET_NAME, TILESET_TEXTURE_KEY, PLACEHOLDER_TILE_PIXELS, PLACEHOLDER_TILE_PIXELS, 0, 0);
  if (!tileset) throw new Error('The terrain tileset texture is missing');
  // The sim decides where tiles are; the layer's corner is the top-left tile's centre minus half a tile.
  const firstTileCentre = tileCentre(grid, { column: 0, row: 0 });
  const layer = tilemap.createLayer(0, tileset, toPixels(firstTileCentre.x - grid.tileSize / 2), toPixels(firstTileCentre.y - grid.tileSize / 2));
  if (!layer) throw new Error('Could not create the terrain layer');
  layer.setScale(toPixels(TILE_SIZE) / PLACEHOLDER_TILE_PIXELS);
  layer.setDepth(TERRAIN_DEPTH);
  return layer as Phaser.Tilemaps.TilemapLayer;
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
