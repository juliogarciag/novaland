import { CHUNK_SIZE, findChunk, mapLandmarks, readMapTiles, spawnPoint, TILE_SIZE, type Landmark, type MapChunk, type MapTiles, type MinimapMarkerShape, type TileCoordinate, type WorldMap } from '@novaland/sim';
import Phaser from 'phaser';
import { chunkKey, chunkRangeOfTiles, chunksToDropAndBuild, sameChunkRange, type ChunkRange } from '../render/chunkRange';
import type { ViewFrame } from '../render/viewFrame';
import { minimapCentre, minimapMarks, type MinimapMark } from './minimapMarks';
import { MINIMAP_TILES_ACROSS, sameMinimapPlacement, type MinimapPlacement } from './minimapPlacement';
import { chunkColorBytes, minimapChunkRanges } from './minimapTerrain';

/** Behind the terrain, where no area put a tile: the colour of the HUD lines' backdrop, opaque so the world behind does not read as terrain. */
const BACKDROP_COLOR = 0x0b0f14;
/** The line around the minimap: dark, like the backdrop of the HUD's lines, so it frames the map without glowing. */
const BORDER_COLOR = 0x0f172a;
const BORDER_ALPHA = 0.9;
/** CSS pixels. */
const BORDER_WIDTH = 2;

/** Marker sizes in CSS pixels: a dot's radius, a diamond's half diagonal. The local player's dot is larger than any other dot and the only white thing on the minimap. */
const DOT_RADIUS = 3;
const DIAMOND_RADIUS = 5;
const LOCAL_PLAYER_RADIUS = 4;
const LOCAL_PLAYER_COLOR = 0xffffff;
/** Every marker has a dark rim, so it reads over any tile colour. */
const OUTLINE_COLOR = 0x0b0f14;
const OUTLINE_WIDTH = 1.5;
/** A mark on the edge has an arrowhead beyond it, pointing at the thing: its length, half the width of its base, and the gap between mark and arrow, in CSS pixels. */
const ARROW_LENGTH = 5;
const ARROW_HALF_BASE = 3.5;
const ARROW_GAP = 1;
/** Room left for the arrow's rim. */
const ARROW_RIM = 2;
/** How far inside the minimap's edge the furthest mark sits, so the largest mark and its arrow are drawn whole. */
const EDGE_INSET = DIAMOND_RADIUS + ARROW_GAP + ARROW_LENGTH + ARROW_RIM;

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
  /** The colour the local player's dot is drawn in, whatever its avatar: 0xRRGGBB. */
  readonly localPlayerColor: number;
  /** How far inside the minimap's edge the furthest mark sits. */
  readonly edgeInset: number;
  readonly marks: readonly (Omit<MinimapMark, 'offset'> & { readonly x: number; readonly y: number })[];
}

interface PaintedChunk {
  readonly coordinate: TileCoordinate;
  readonly image: Phaser.GameObjects.Image;
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
 * moving a camera. The markers are drawn again every frame; `minimapMarks`
 * marks at most a fixed number of the frame's entities.
 *
 * That camera belongs to the minimap alone: its viewport is the minimap's
 * square, which clips the chunk textures and the markers, and it scrolls
 * over a space where one tile is `pixelsPerTile` device pixels. It draws the
 * minimap's own objects and nothing else the scene holds, now or later; the
 * scene's main camera draws everything but them.
 */
export class Minimap {
  private readonly tiles: MapTiles;
  private readonly landmarks: readonly Landmark[];
  /** Every chunk the map could hold: nothing outside it is ever looked for. */
  private readonly chunksOfMap: ChunkRange;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  /** Two filled squares the scene's main camera draws under the minimap: the border is the larger one, showing around the backdrop. Whole pixels, where a stroked outline would straddle them. */
  private readonly border: Phaser.GameObjects.Rectangle;
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly markers: Phaser.GameObjects.Graphics;
  private readonly paintedChunks = new Map<string, PaintedChunk>();
  private placement: MinimapPlacement | undefined;
  private lastRanges: { readonly draw: ChunkRange; readonly keep: ChunkRange } | undefined;
  private centre: { readonly x: number; readonly y: number };
  private marks: readonly MinimapMark[] = [];
  private chunksPainted = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    map: WorldMap,
  ) {
    this.tiles = readMapTiles(map);
    this.landmarks = mapLandmarks(map);
    this.chunksOfMap = chunkRangeOfTiles(this.tiles.bounds);
    // Until the local player is drawn the minimap looks at where they will appear.
    this.centre = spawnPoint(map);
    this.camera = scene.cameras.add(0, 0, 1, 1);
    // The scene's other objects, those here already and those added later, are not the minimap camera's to draw.
    this.camera.ignore(scene.children.list);
    const ignoreNewObject = (gameObject: Phaser.GameObjects.GameObject): void => {
      this.camera.ignore(gameObject);
    };
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, ignoreNewObject);
    this.border = scene.add.rectangle(0, 0, 1, 1, BORDER_COLOR, BORDER_ALPHA).setOrigin(0, 0);
    this.backdrop = scene.add.rectangle(0, 0, 1, 1, BACKDROP_COLOR, 1).setOrigin(0, 0);
    this.markers = this.drawnByMinimapCameraOnly(scene.add.graphics().setDepth(MARKER_DEPTH));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, ignoreNewObject);
      for (const key of [...this.paintedChunks.keys()]) this.dropChunk(key);
    });
  }

  /** Puts the minimap where `placement` says. Call when the canvas, the pixel ratio or the HUD lines change size; the same placement again does nothing. */
  place(placement: MinimapPlacement): void {
    if (this.placement && sameMinimapPlacement(this.placement, placement)) return;
    this.placement = placement;
    const { x, y, size, pixelsPerTile, pixelRatio } = placement;
    this.camera.setViewport(x, y, size, size);
    const borderWidth = Math.max(1, Math.round(BORDER_WIDTH * pixelRatio));
    this.border.setPosition(x - borderWidth, y - borderWidth).setSize(size + 2 * borderWidth, size + 2 * borderWidth);
    this.backdrop.setPosition(x, y).setSize(size, size);
    // A tile may take another number of pixels now (the window moved to another screen).
    for (const { coordinate, image } of this.paintedChunks.values()) {
      image.setPosition(coordinate.column * CHUNK_SIZE * pixelsPerTile, coordinate.row * CHUNK_SIZE * pixelsPerTile).setScale(pixelsPerTile);
    }
  }

  /**
   * Shows the world around the local player as `frame` drew it. Call every frame, after `place`.
   * Without a frame or a local player the minimap stays where it was. Positions come from the server
   * online, so none is trusted: see `minimapCentre` and `minimapMarks`.
   */
  show({ frame, localEid }: { frame: ViewFrame | undefined; localEid: number | undefined }): void {
    const placement = this.placement;
    if (!placement) return;
    const renderables = frame?.renderables ?? [];
    this.centre = minimapCentre({ renderables, localEid, previous: this.centre });
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
      chunksDrawn: [...this.paintedChunks.keys()],
      chunksInMap: this.tiles.chunks.length,
      chunksPainted: this.chunksPainted,
      localPlayerColor: LOCAL_PLAYER_COLOR,
      edgeInset: EDGE_INSET,
      marks: this.marks.map(({ offset, ...mark }) => ({
        ...mark,
        x: origin.x + (this.centre.x / TILE_SIZE + offset.x) * cssPixelsPerTile,
        y: origin.y + (this.centre.y / TILE_SIZE + offset.y) * cssPixelsPerTile,
      })),
    };
  }

  private showChunksNear(centre: { readonly x: number; readonly y: number }, { pixelsPerTile }: MinimapPlacement): void {
    const { draw, keep } = minimapChunkRanges({ centre, tilesAcross: MINIMAP_TILES_ACROSS, chunksOfMap: this.chunksOfMap });
    if (this.lastRanges && sameChunkRange(this.lastRanges.draw, draw) && sameChunkRange(this.lastRanges.keep, keep)) return;
    this.lastRanges = { draw, keep };
    const { drop, build } = chunksToDropAndBuild({ drawnKeys: this.paintedChunks.keys(), draw, keep });
    for (const key of drop) this.dropChunk(key);
    for (const coordinate of build) {
      const chunk = findChunk(this.tiles, coordinate);
      if (chunk) this.paintedChunks.set(chunkKey(coordinate), { coordinate, image: this.paintChunk(chunk, pixelsPerTile) });
    }
  }

  private paintChunk(chunk: MapChunk, pixelsPerTile: number): Phaser.GameObjects.Image {
    const textureKey = chunkTextureKey(chunkKey(chunk));
    if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    const texture = this.scene.textures.createCanvas(textureKey, CHUNK_SIZE, CHUNK_SIZE);
    if (!texture) throw new Error('Could not create a minimap chunk texture');
    texture.getContext().putImageData(new ImageData(chunkColorBytes(chunk), CHUNK_SIZE, CHUNK_SIZE), 0, 0);
    texture.refresh();
    // Scaled up with linear filtering, a tile's colour would bleed into its neighbours.
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const image = this.scene.add.image(chunk.firstTile.column * pixelsPerTile, chunk.firstTile.row * pixelsPerTile, textureKey);
    image.setOrigin(0, 0).setScale(pixelsPerTile).setDepth(TERRAIN_DEPTH);
    this.chunksPainted += 1;
    return this.drawnByMinimapCameraOnly(image);
  }

  private dropChunk(key: string): void {
    this.paintedChunks.get(key)?.image.destroy();
    this.paintedChunks.delete(key);
    if (this.scene.textures.exists(chunkTextureKey(key))) this.scene.textures.remove(chunkTextureKey(key));
  }

  /** Makes one of the minimap's own objects visible to its camera and to no other: a camera skips an object whose filter has the camera's bit. */
  private drawnByMinimapCameraOnly<T extends Phaser.GameObjects.GameObject>(gameObject: T): T {
    gameObject.cameraFilter = this.scene.cameras.main.id;
    return gameObject;
  }

  private drawMarks({ pixelsPerTile, pixelRatio }: MinimapPlacement): void {
    const graphics = this.markers;
    graphics.clear();
    graphics.lineStyle(OUTLINE_WIDTH * pixelRatio, OUTLINE_COLOR, 1);
    for (const mark of this.marks) {
      const x = (this.centre.x / TILE_SIZE + mark.offset.x) * pixelsPerTile;
      const y = (this.centre.y / TILE_SIZE + mark.offset.y) * pixelsPerTile;
      const radius = (mark.isLocalPlayer ? LOCAL_PLAYER_RADIUS : radiusOfShape(mark.shape)) * pixelRatio;
      graphics.fillStyle(mark.isLocalPlayer ? LOCAL_PLAYER_COLOR : mark.color, 1);
      const distance = Math.hypot(mark.offset.x, mark.offset.y);
      if (mark.onEdge && distance > 0) {
        const corners = arrowCorners({ from: { x, y }, toward: { x: mark.offset.x / distance, y: mark.offset.y / distance }, startsAt: radius + ARROW_GAP * pixelRatio, pixelRatio });
        graphics.fillTriangle(...corners);
        graphics.strokeTriangle(...corners);
      }
      drawShape(graphics, mark.shape, { x, y, radius });
    }
  }
}

function chunkTextureKey(key: string): string {
  return `minimap-chunk:${key}`;
}

function radiusOfShape(shape: MinimapMarkerShape): number {
  switch (shape) {
    case 'dot':
      return DOT_RADIUS;
    case 'diamond':
      return DIAMOND_RADIUS;
    default:
      return shape satisfies never;
  }
}

/** Fills and rims one marker shape. A shape added to `MinimapMarkerShape` does not compile until it has a case here and in `radiusOfShape`. */
function drawShape(graphics: Phaser.GameObjects.Graphics, shape: MinimapMarkerShape, { x, y, radius }: { x: number; y: number; radius: number }): void {
  switch (shape) {
    case 'dot':
      graphics.fillCircle(x, y, radius);
      graphics.strokeCircle(x, y, radius);
      return;
    case 'diamond':
      graphics.beginPath();
      graphics.moveTo(x, y - radius);
      graphics.lineTo(x + radius, y);
      graphics.lineTo(x, y + radius);
      graphics.lineTo(x - radius, y);
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
      return;
    default:
      shape satisfies never;
  }
}

/** The three corners of an arrowhead, as x and y pairs: its tip `ARROW_LENGTH` past `startsAt` from `from` along the unit vector `toward`, its base across that line at `startsAt`. */
function arrowCorners({ from, toward, startsAt, pixelRatio }: { from: { x: number; y: number }; toward: { x: number; y: number }; startsAt: number; pixelRatio: number }): [number, number, number, number, number, number] {
  const tip = startsAt + ARROW_LENGTH * pixelRatio;
  const halfBase = ARROW_HALF_BASE * pixelRatio;
  const base = { x: from.x + toward.x * startsAt, y: from.y + toward.y * startsAt };
  return [from.x + toward.x * tip, from.y + toward.y * tip, base.x - toward.y * halfBase, base.y + toward.x * halfBase, base.x + toward.y * halfBase, base.y - toward.x * halfBase];
}
