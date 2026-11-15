import { CHUNK_SIZE, findChunk, mapLandmarks, readMapTiles, spawnPoint, TILE_SIZE, type Landmark, type MapChunk, type MapTiles, type WorldMap } from '@novaland/sim';
import Phaser from 'phaser';
import { chunkKey, chunkRangeAround, chunkRangeOfTiles, chunkRangeWithin, chunksToDropAndBuild, sameChunkRange, type ChunkRange } from '../render/chunkRange';
import type { ViewFrame } from '../render/viewFrame';
import { minimapMarks, type MinimapMark } from './minimapMarks';
import { MINIMAP_TILES_ACROSS, sameMinimapPlacement, type MinimapPlacement } from './minimapPlacement';
import { chunkPixels, MINIMAP_KEEP_MARGIN_TILES, worldPixelsShown } from './minimapTerrain';

/** Behind the terrain, where no area put a tile: the colour of the HUD lines' backdrop, opaque so the world behind does not read as terrain. */
const BACKDROP_COLOR = 0x0b0f14;
/** The line around the minimap: the HUD's text colour, in CSS pixels. */
const BORDER_COLOR = 0xe2e8f0;
const BORDER_ALPHA = 0.6;
const BORDER_WIDTH = 1;

/** Marker sizes in CSS pixels: a dot's radius, a diamond's half diagonal. The local player's dot is the largest thing on the minimap and the only white one. */
const DOT_RADIUS = 3;
const DIAMOND_RADIUS = 5;
const LOCAL_PLAYER_RADIUS = 4;
const LOCAL_PLAYER_COLOR = 0xffffff;
/** Every marker has a dark rim, so it reads over any tile colour. */
const OUTLINE_COLOR = 0x0b0f14;
const OUTLINE_WIDTH = 1.5;
/** A mark on the edge has an arrowhead beyond it, pointing at the thing: its length, and the gap between mark and arrow, in CSS pixels. */
const ARROW_LENGTH = 5;
const ARROW_GAP = 1;
/** How far inside the minimap's edge an out-of-range mark sits, so the mark and its arrow are drawn whole. */
const EDGE_INSET = DIAMOND_RADIUS + ARROW_GAP + ARROW_LENGTH + 2;

const TERRAIN_DEPTH = 0;
const MARKER_DEPTH = 1;

/** What the minimap shows right now. Read by dev tooling and end-to-end checks; lengths on screen are CSS pixels from the window's top-left corner. */
export interface MinimapReport {
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly tilesAcross: number;
  readonly cssPixelsPerTile: number;
  /** The point of the world at the minimap's centre, in metres. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Where the world's origin (tile (0, 0)'s top-left corner) would be drawn: tile (column, row) starts `cssPixelsPerTile` times that many pixels from it. */
  readonly worldOriginOnScreen: { readonly x: number; readonly y: number };
  /** Chunk coordinates of the chunks that have a texture, as "column,row". */
  readonly chunksDrawn: readonly string[];
  /** Chunks the map holds. */
  readonly chunksInMap: number;
  /** Chunk textures painted since the page loaded: it grows when the player walks into new chunks and at no other time. */
  readonly chunksPainted: number;
  readonly marks: readonly (Omit<MinimapMark, 'offset'> & { readonly x: number; readonly y: number })[];
}

/**
 * The minimap: the terrain around the local player and a marker for every
 * thing whose def (or landmark) says it has one. It is a view and nothing
 * else: it reads the map and the frame the world scene drew, and decides
 * nothing.
 *
 * What it costs depends on its own size, not on the world's. The terrain is
 * one small texture per chunk, a pixel per tile, painted once when the
 * chunk comes within the minimap's square and dropped when it is well out
 * of it (the terrain renderer's pattern, ADR 0013). A frame in which the
 * player stays in the same chunks paints nothing: following the player is
 * moving a camera.
 *
 * That camera belongs to the minimap alone: its viewport is the minimap's
 * square, which clips the chunk textures and the markers, and it scrolls
 * over a space where one tile is `pixelsPerTile` device pixels. The HUD's
 * own camera draws the backdrop and the border and ignores the rest.
 */
export class Minimap {
  private readonly tiles: MapTiles;
  private readonly landmarks: readonly Landmark[];
  /** Every chunk the map could hold: nothing outside it is ever looked for. */
  private readonly chunksOfMap: ChunkRange;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  /** Two filled squares under the minimap's camera: the border is the larger one showing around the backdrop. Whole pixels, where a stroked outline would straddle them. */
  private readonly border: Phaser.GameObjects.Rectangle;
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly chunkImages = new Map<string, Phaser.GameObjects.Image>();
  private placement: MinimapPlacement | undefined;
  private lastRanges: { readonly draw: ChunkRange; readonly keep: ChunkRange } | undefined;
  private centre: { readonly x: number; readonly y: number };
  private marks: readonly MinimapMark[] = [];
  private chunksPainted = 0;

  /** `otherHudObjects` is everything else the HUD scene draws: the minimap's camera must not draw it a second time. */
  constructor(
    private readonly scene: Phaser.Scene,
    map: WorldMap,
    otherHudObjects: readonly Phaser.GameObjects.GameObject[],
  ) {
    this.tiles = readMapTiles(map);
    this.landmarks = mapLandmarks(map);
    this.chunksOfMap = chunkRangeOfTiles(this.tiles.bounds);
    // Until the local player is drawn the minimap looks at where they will appear.
    this.centre = spawnPoint(map);
    this.border = scene.add.rectangle(0, 0, 1, 1, BORDER_COLOR, BORDER_ALPHA).setOrigin(0, 0);
    this.backdrop = scene.add.rectangle(0, 0, 1, 1, BACKDROP_COLOR, 1).setOrigin(0, 0);
    this.markers = scene.add.graphics().setDepth(MARKER_DEPTH);
    this.camera = scene.cameras.add(0, 0, 1, 1);
    this.camera.ignore([...otherHudObjects, this.border, this.backdrop]);
    scene.cameras.main.ignore(this.markers);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const key of [...this.chunkImages.keys()]) this.dropChunk(key);
    });
  }

  /** Puts the minimap where `placement` says. Call when the canvas, the pixel ratio or the HUD lines change size; the same placement again does nothing. */
  place(placement: MinimapPlacement): void {
    if (this.placement && sameMinimapPlacement(this.placement, placement)) return;
    const tileSizeChanged = this.placement?.pixelsPerTile !== placement.pixelsPerTile;
    this.placement = placement;
    const { x, y, size, pixelsPerTile, pixelRatio } = placement;
    this.camera.setViewport(x, y, size, size);
    const borderWidth = Math.max(1, Math.round(BORDER_WIDTH * pixelRatio));
    this.border.setPosition(x - borderWidth, y - borderWidth).setSize(size + 2 * borderWidth, size + 2 * borderWidth);
    this.backdrop.setPosition(x, y).setSize(size, size);
    if (!tileSizeChanged) return;
    for (const [key, image] of this.chunkImages) {
      const [column, row] = key.split(',').map(Number) as [number, number];
      image.setPosition(column * CHUNK_SIZE * pixelsPerTile, row * CHUNK_SIZE * pixelsPerTile).setScale(pixelsPerTile);
    }
  }

  /**
   * Shows the world around the local player as `frame` drew it. Call every frame, after `place`.
   * Without a frame or a local player the minimap stays where it was. Positions come from the server
   * online, so none is trusted: a centre that is not finite changes nothing, and only chunks inside the map are looked at.
   */
  show({ frame, localEid }: { frame: ViewFrame | undefined; localEid: number | undefined }): void {
    const placement = this.placement;
    if (!placement) return;
    const renderables = frame?.renderables ?? [];
    const localPlayer = localEid === undefined ? undefined : renderables.find((renderable) => renderable.eid === localEid);
    if (localPlayer && Number.isFinite(localPlayer.x) && Number.isFinite(localPlayer.y)) this.centre = { x: localPlayer.x, y: localPlayer.y };
    this.showChunksNear(this.centre, placement);
    const { size, pixelsPerTile, pixelRatio } = placement;
    // Whole device pixels, so every tile of the minimap covers the same pixels on screen.
    this.camera.setScroll(Math.round((this.centre.x / TILE_SIZE) * pixelsPerTile - size / 2), Math.round((this.centre.y / TILE_SIZE) * pixelsPerTile - size / 2));
    this.marks = minimapMarks({
      renderables,
      localEid,
      landmarks: this.landmarks,
      centre: this.centre,
      rangeTiles: MINIMAP_TILES_ACROSS / 2,
      edgeTiles: MINIMAP_TILES_ACROSS / 2 - (EDGE_INSET * pixelRatio) / pixelsPerTile,
    });
    this.drawMarks(placement);
  }

  report(): MinimapReport | undefined {
    const placement = this.placement;
    if (!placement) return undefined;
    const { x, y, size, pixelsPerTile, pixelRatio } = placement;
    const origin = { x: (x - this.camera.scrollX) / pixelRatio, y: (y - this.camera.scrollY) / pixelRatio };
    const cssPixelsPerTile = pixelsPerTile / pixelRatio;
    return {
      rect: { x: x / pixelRatio, y: y / pixelRatio, width: size / pixelRatio, height: size / pixelRatio },
      tilesAcross: MINIMAP_TILES_ACROSS,
      cssPixelsPerTile,
      centre: this.centre,
      worldOriginOnScreen: origin,
      chunksDrawn: [...this.chunkImages.keys()],
      chunksInMap: this.tiles.chunks.length,
      chunksPainted: this.chunksPainted,
      marks: this.marks.map(({ offset, ...mark }) => ({
        ...mark,
        x: origin.x + (this.centre.x / TILE_SIZE + offset.x) * cssPixelsPerTile,
        y: origin.y + (this.centre.y / TILE_SIZE + offset.y) * cssPixelsPerTile,
      })),
    };
  }

  private showChunksNear(centre: { readonly x: number; readonly y: number }, { pixelsPerTile }: MinimapPlacement): void {
    const shown = worldPixelsShown(centre, MINIMAP_TILES_ACROSS);
    const draw = chunkRangeWithin(chunkRangeAround(shown, 0), this.chunksOfMap);
    const keep = chunkRangeWithin(chunkRangeAround(shown, MINIMAP_KEEP_MARGIN_TILES), this.chunksOfMap);
    if (this.lastRanges && sameChunkRange(this.lastRanges.draw, draw) && sameChunkRange(this.lastRanges.keep, keep)) return;
    this.lastRanges = { draw, keep };
    const { drop, build } = chunksToDropAndBuild({ drawnKeys: this.chunkImages.keys(), draw, keep });
    for (const key of drop) this.dropChunk(key);
    for (const coordinate of build) {
      const chunk = findChunk(this.tiles, coordinate);
      if (chunk) this.chunkImages.set(chunkKey(coordinate), this.paintChunk(chunk, pixelsPerTile));
    }
  }

  private paintChunk(chunk: MapChunk, pixelsPerTile: number): Phaser.GameObjects.Image {
    const textureKey = chunkTextureKey(chunkKey(chunk));
    if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    const texture = this.scene.textures.createCanvas(textureKey, CHUNK_SIZE, CHUNK_SIZE);
    if (!texture) throw new Error('Could not create a minimap chunk texture');
    texture.getContext().putImageData(new ImageData(chunkPixels(chunk), CHUNK_SIZE, CHUNK_SIZE), 0, 0);
    texture.refresh();
    // Scaled up with linear filtering, a tile's colour would bleed into its neighbours.
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const image = this.scene.add.image(chunk.firstTile.column * pixelsPerTile, chunk.firstTile.row * pixelsPerTile, textureKey);
    image.setOrigin(0, 0).setScale(pixelsPerTile).setDepth(TERRAIN_DEPTH);
    this.scene.cameras.main.ignore(image);
    this.chunksPainted += 1;
    return image;
  }

  private dropChunk(key: string): void {
    this.chunkImages.get(key)?.destroy();
    this.chunkImages.delete(key);
    if (this.scene.textures.exists(chunkTextureKey(key))) this.scene.textures.remove(chunkTextureKey(key));
  }

  /** Markers are few (the seats and the landmarks), so they are simply drawn again every frame, in the minimap camera's space. */
  private drawMarks({ pixelsPerTile, pixelRatio }: MinimapPlacement): void {
    const graphics = this.markers;
    graphics.clear();
    graphics.lineStyle(OUTLINE_WIDTH * pixelRatio, OUTLINE_COLOR, 1);
    for (const mark of this.marks) {
      const x = (this.centre.x / TILE_SIZE + mark.offset.x) * pixelsPerTile;
      const y = (this.centre.y / TILE_SIZE + mark.offset.y) * pixelsPerTile;
      const radius = (mark.isLocalPlayer ? LOCAL_PLAYER_RADIUS : mark.shape === 'diamond' ? DIAMOND_RADIUS : DOT_RADIUS) * pixelRatio;
      graphics.fillStyle(mark.isLocalPlayer ? LOCAL_PLAYER_COLOR : mark.color, 1);
      if (mark.onEdge) {
        const distance = Math.hypot(mark.offset.x, mark.offset.y);
        const toward = { x: mark.offset.x / distance, y: mark.offset.y / distance };
        const base = radius + ARROW_GAP * pixelRatio;
        const tip = base + ARROW_LENGTH * pixelRatio;
        const halfBase = ARROW_LENGTH * pixelRatio * 0.7;
        const corners = [x + toward.x * tip, y + toward.y * tip, x + toward.x * base - toward.y * halfBase, y + toward.y * base + toward.x * halfBase, x + toward.x * base + toward.y * halfBase, y + toward.y * base - toward.x * halfBase] as const;
        graphics.fillTriangle(...corners);
        graphics.strokeTriangle(...corners);
      }
      if (mark.shape === 'diamond') {
        graphics.beginPath();
        graphics.moveTo(x, y - radius);
        graphics.lineTo(x + radius, y);
        graphics.lineTo(x, y + radius);
        graphics.lineTo(x - radius, y);
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();
      } else {
        graphics.fillCircle(x, y, radius);
        graphics.strokeCircle(x, y, radius);
      }
    }
  }
}

function chunkTextureKey(key: string): string {
  return `minimap-chunk:${key}`;
}
