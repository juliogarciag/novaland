import { CHUNK_SIZE, findChunk, readMapTiles, terrainDefs, tileDefIdAt, TILE_SIZE, type GroundTileSprite, type MapChunk, type MapTiles, type StandingTileSprite, type WorldMap } from '@novaland/sim';
import Phaser from 'phaser';
import { chunkColorBytes } from './chunkColors';
import { chunkKey, chunkRangeAround, chunkRangeOfTiles, chunkRangeWithin, chunksToDropAndBuild, DRAW_MARGIN_TILES, KEEP_MARGIN_TILES, sameChunkRange, type ChunkRange, type PixelRect } from './chunkRange';
import { GROUND_TILE_PIXELS, groundTileIndexRows, groundTilesetSlots, type GroundTilesetSlot } from './groundTiles';
import { spriteSheetUrl } from './spriteUrl';
import { standingTilePlacements } from './standingTiles';
import type { TerrainDetail } from './terrainDetail';
import { PIXELS_PER_METRE, toPixels } from './units';

const TILESET_TEXTURE_KEY = 'terrain-ground-tiles';
const TILESET_NAME = 'terrain';
const COLORS_TEXTURE_KEY_PREFIX = 'terrain-colors:';

/**
 * Draws below every entity. Entities are depth-sorted by their bottom edge in
 * pixels (render/entities.ts), which is negative north of the world's origin, so
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

/** How much terrain is drawn right now. Read by dev tooling and end-to-end checks. */
export interface TerrainReport {
  /** Chunk coordinates of the chunks that have game objects, as "column,row". */
  readonly chunksDrawn: readonly string[];
  /** Chunks the map holds. */
  readonly chunksInMap: number;
  /** How the drawn chunks are drawn: all of them the same way. */
  readonly detail: TerrainDetail;
  /** Tiles alive in the ground tilemaps: `CHUNK_SIZE` squared for each chunk drawn as art, none when drawn as colours. */
  readonly groundTiles: number;
  /** Standing images alive (trees, rocks). */
  readonly standingImages: number;
  /** How far from what the camera shows a drawn chunk is kept, in tiles: with the view's size, the most chunks that can ever be drawn. */
  readonly keepMarginTiles: number;
}

interface DrawnChunk {
  /** The ground: a tilemap when drawn as art, one image of a pixel per tile when drawn as colours. */
  readonly ground: Phaser.Tilemaps.Tilemap | Phaser.GameObjects.Image;
  readonly standingImages: readonly Phaser.GameObjects.Image[];
  /** The texture made for this chunk alone, to remove with it. */
  readonly ownTextureKey?: string;
}

/**
 * Draws the map's terrain from the same chunks the sim builds its
 * colliders from, and only the chunks near the camera: what is alive
 * depends on the screen, not on the size of the world (ADR 0013).
 *
 * Each drawn chunk is two things. The ground is a Phaser tilemap of
 * `CHUNK_SIZE` by `CHUNK_SIZE` tiles below everything; all chunks share one
 * tileset, put together here once (render/groundTiles.ts says which tile is
 * where): a def with a `groundSprite` (grass, water, the shallows) brings the
 * tiles of its sheet and each tile shows the variant its world column and
 * row pick, or, where a lake ends, the tile with that edge drawn on it; any
 * other def is one flat tile in its colour. Where no area put a tile,
 * nothing is drawn.
 *
 * A def with a `standingSprite` (a tree, a rock) is one image per tile on
 * top of that, standing on the tile's bottom edge and depth-sorted among
 * the entities by it, with the def's ground tile under it.
 *
 * A sheet that failed to load is not fatal: its def is drawn flat in its
 * own colour instead.
 *
 * Zoomed far out (`TerrainDetail` 'colors', render/terrainDetail.ts says
 * when) a chunk is one image instead: a texture of one pixel per tile in the
 * tile's own colour, stretched over the chunk, and no standing images. A
 * chunk then costs one quad whatever is on it, so the whole of a large map
 * can be on screen. All drawn chunks are drawn the same way; when the way
 * changes they are all dropped and the ones near the view built again.
 */
export class TerrainRenderer {
  private readonly tiles: MapTiles;
  private readonly slots: readonly GroundTilesetSlot[];
  /** Every chunk the map could hold: nothing outside it is ever looked for. */
  private readonly chunksOfMap: ChunkRange;
  private readonly drawnChunks = new Map<string, DrawnChunk>();
  private lastView: { readonly draw: ChunkRange; readonly keep: ChunkRange } | undefined;
  private detail: TerrainDetail = 'art';

  constructor(
    private readonly scene: Phaser.Scene,
    map: WorldMap,
  ) {
    this.tiles = readMapTiles(map);
    this.chunksOfMap = chunkRangeOfTiles(this.tiles.bounds);
    for (const sprite of standingTileSprites()) {
      if (this.isTextureLoaded(sprite.key)) scene.textures.get(sprite.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.slots = groundTilesetSlots(terrainDefs, (key) => this.isTextureLoaded(key));
    buildGroundTileset(scene, this.slots);
    // A chunk drawn as colours owns a texture, and textures outlive the scene that made them.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const key of [...this.drawnChunks.keys()]) this.dropChunk(key);
      this.lastView = undefined;
    });
  }

  /**
   * Draws the chunks near `view` (what the camera shows, in world pixels) the way `detail` says and drops those far from it. Call every frame.
   * The camera follows a position that online comes from the server, so the view is not trusted: one that is not
   * finite changes nothing, and however large it is, only chunks inside the map are looked at.
   */
  show(view: PixelRect, detail: TerrainDetail): void {
    if (![view.x, view.y, view.width, view.height].every(Number.isFinite)) return;
    if (detail !== this.detail) {
      for (const key of [...this.drawnChunks.keys()]) this.dropChunk(key);
      this.detail = detail;
      this.lastView = undefined;
    }
    const draw = chunkRangeWithin(chunkRangeAround(view, DRAW_MARGIN_TILES), this.chunksOfMap);
    const keep = chunkRangeWithin(chunkRangeAround(view, KEEP_MARGIN_TILES), this.chunksOfMap);
    if (this.lastView && sameChunkRange(this.lastView.draw, draw) && sameChunkRange(this.lastView.keep, keep)) return;
    this.lastView = { draw, keep };
    const { drop, build } = chunksToDropAndBuild({ drawnKeys: this.drawnChunks.keys(), draw, keep });
    for (const key of drop) this.dropChunk(key);
    for (const coordinate of build) {
      const chunk = findChunk(this.tiles, coordinate);
      if (chunk) this.drawnChunks.set(chunkKey(coordinate), detail === 'art' ? this.drawChunkAsArt(chunk) : this.drawChunkAsColors(chunk));
    }
  }

  report(): TerrainReport {
    let standingImages = 0;
    for (const drawn of this.drawnChunks.values()) standingImages += drawn.standingImages.length;
    return {
      chunksDrawn: [...this.drawnChunks.keys()],
      chunksInMap: this.tiles.chunks.length,
      detail: this.detail,
      groundTiles: this.detail === 'art' ? this.drawnChunks.size * CHUNK_SIZE * CHUNK_SIZE : 0,
      standingImages,
      keepMarginTiles: KEEP_MARGIN_TILES,
    };
  }

  private drawChunkAsArt(chunk: MapChunk): DrawnChunk {
    const tileIndexRows = groundTileIndexRows({ chunk, slots: this.slots, isStandingImageDrawn: (sprite) => this.isTextureLoaded(sprite.key), defIdAt: (tile) => tileDefIdAt(this.tiles, tile) });
    const tilemap = this.scene.make.tilemap({ data: tileIndexRows, tileWidth: GROUND_TILE_PIXELS, tileHeight: GROUND_TILE_PIXELS });
    const tileset = tilemap.addTilesetImage(TILESET_NAME, TILESET_TEXTURE_KEY, GROUND_TILE_PIXELS, GROUND_TILE_PIXELS, 0, 0);
    if (!tileset) throw new Error('The terrain tileset texture is missing');
    // The sim decides where tiles are: the layer's corner is the corner of the chunk's first tile.
    const layer = tilemap.createLayer(0, tileset, toPixels(chunk.firstTile.column * TILE_SIZE), toPixels(chunk.firstTile.row * TILE_SIZE));
    if (!layer) throw new Error('Could not create a terrain layer');
    layer.setScale(toPixels(TILE_SIZE) / GROUND_TILE_PIXELS);
    layer.setDepth(TERRAIN_DEPTH);
    const standingImages: Phaser.GameObjects.Image[] = [];
    for (const placement of standingTilePlacements(chunk)) {
      if (!this.isTextureLoaded(placement.sprite.key)) continue;
      const image = this.scene.add.image(placement.x, placement.y, placement.sprite.key, placement.frame);
      image.setOrigin(0.5, 1);
      image.setScale(PIXELS_PER_METRE / placement.sprite.pixelsPerMetre);
      image.setDepth(placement.depth);
      standingImages.push(image);
    }
    return { ground: tilemap, standingImages };
  }

  private drawChunkAsColors(chunk: MapChunk): DrawnChunk {
    const textureKey = `${COLORS_TEXTURE_KEY_PREFIX}${chunkKey(chunk)}`;
    if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    const texture = this.scene.textures.addUint8Array(textureKey, new Uint8Array(chunkColorBytes(chunk).buffer), CHUNK_SIZE, CHUNK_SIZE);
    if (!texture) throw new Error('Could not create a terrain colours texture');
    // Stretched with linear filtering, a tile's colour would bleed into its neighbours.
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const image = this.scene.add.image(toPixels(chunk.firstTile.column * TILE_SIZE), toPixels(chunk.firstTile.row * TILE_SIZE), textureKey);
    image.setOrigin(0, 0);
    // One texture pixel is one tile.
    image.setScale(toPixels(TILE_SIZE));
    image.setDepth(TERRAIN_DEPTH);
    return { ground: image, standingImages: [], ownTextureKey: textureKey };
  }

  private dropChunk(key: string): void {
    const drawn = this.drawnChunks.get(key);
    if (!drawn) return;
    drawn.ground.destroy();
    for (const image of drawn.standingImages) image.destroy();
    if (drawn.ownTextureKey !== undefined && this.scene.textures.exists(drawn.ownTextureKey)) this.scene.textures.remove(drawn.ownTextureKey);
    this.drawnChunks.delete(key);
  }

  private isTextureLoaded(key: string): boolean {
    return this.scene.textures.exists(key);
  }
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
 * other gets one flat-colour tile, with a darker rim when the def stands up
 * from the ground, so that a tree or rock whose image is missing still reads
 * as an object. Water without its sheet has no rim: a lake is one surface.
 */
function buildGroundTileset(scene: Phaser.Scene, slots: readonly GroundTilesetSlot[]): void {
  // Built again for every renderer: the slots depend on which sheets loaded, and a strip from an earlier scene may be laid out differently.
  if (scene.textures.exists(TILESET_TEXTURE_KEY)) scene.textures.remove(TILESET_TEXTURE_KEY);
  const tileCount = slots.reduce((count, slot) => count + slot.tileCount, 0);
  const tileset = scene.textures.createCanvas(TILESET_TEXTURE_KEY, GROUND_TILE_PIXELS * tileCount, GROUND_TILE_PIXELS);
  if (!tileset) throw new Error('Could not create the terrain tileset texture');
  const context = tileset.getContext();
  for (const slot of slots) {
    const slotLeft = slot.firstTileIndex * GROUND_TILE_PIXELS;
    if (slot.groundSprite) {
      for (let sheetTile = 0; sheetTile < slot.tileCount; sheetTile += 1) tileset.drawFrame(slot.groundSprite.key, sheetTile, slotLeft + sheetTile * GROUND_TILE_PIXELS, 0, false);
      continue;
    }
    context.fillStyle = cssColor(slot.def.color);
    context.fillRect(slotLeft, 0, GROUND_TILE_PIXELS, GROUND_TILE_PIXELS);
    if (slot.def.standingSprite) {
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
