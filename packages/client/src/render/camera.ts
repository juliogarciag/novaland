import { readMapTiles, type WorldMap } from '@novaland/sim';
import type Phaser from 'phaser';
import type { PixelRect } from './chunkRange';
import { PIXELS_PER_METRE, toPixels } from './units';
import { zoomLevels } from './zoom';

/** What a camera is looking at, in pixels. Read by dev tooling and end-to-end checks. */
export interface CameraView {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  /** Canvas size in device pixels. */
  readonly width: number;
  readonly height: number;
  /** What the camera may not look past: the map, or, along a side where the window shows more than the map, the view with the map in its middle. */
  readonly bounds: PixelRect;
  /** The part of the world on screen. */
  readonly worldView: PixelRect;
  readonly visibleMetres: { readonly width: number; readonly height: number };
}

/** Where the mouse wheel has the camera. Read by the HUD, dev tooling and end-to-end checks. */
export interface ZoomReport {
  /** Every zoom the wheel steps through, nearest first: the normal view, then each step out. */
  readonly levels: readonly number[];
  /** How many steps out of the normal view the camera is: an index into `levels`. */
  readonly stepsOut: number;
}

/**
 * A camera that keeps one target in the middle of the screen, never looks
 * past the map (the rectangle that holds every area) and draws texture
 * pixels as whole screen pixels. The zoom is a whole number picked from the
 * canvas width; `zoomOut` steps it away from that and back (render/zoom.ts
 * says through which zooms). Zoomed out until the window shows more than
 * the map, the map sits in the middle of it.
 */
export class MapCamera {
  private readonly map: PixelRect;
  private readonly tilePixels: number;
  private levels: readonly number[] = [1];
  private stepsOut = 0;

  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    map: WorldMap,
  ) {
    const { bounds, tileSize } = readMapTiles(map);
    this.map = { x: toPixels(bounds.column * tileSize), y: toPixels(bounds.row * tileSize), width: toPixels(bounds.width * tileSize), height: toPixels(bounds.height * tileSize) };
    this.tilePixels = toPixels(tileSize);
    this.keepInsideMap();
  }

  /** Picks the zooms for a canvas of this size in device pixels, and stays as many steps out as it was. Call again whenever the canvas changes size. */
  fitZoomTo({ width, height }: { width: number; height: number }): void {
    this.levels = zoomLevels({ canvasWidth: width, canvasHeight: height, mapWidth: this.map.width, mapHeight: this.map.height });
    this.zoomOut(0);
  }

  /** Steps the zoom out by `steps` levels, or in when negative, stopping at the normal view and at the furthest one. */
  zoomOut(steps: number): void {
    const wanted = Number.isFinite(steps) ? this.stepsOut + Math.trunc(steps) : this.stepsOut;
    this.stepsOut = Math.min(Math.max(0, wanted), this.levels.length - 1);
    this.camera.setZoom(this.levels[this.stepsOut] ?? 1);
    this.keepInsideMap();
  }

  zoomReport(): ZoomReport {
    return { levels: this.levels, stepsOut: this.stepsOut };
  }

  /**
   * The part of the world on screen right now, in world pixels. Phaser only
   * refreshes `camera.worldView` when it renders; this is the rectangle it
   * will render, from the scroll and zoom as they are now, so it is right
   * straight after `lookAt` and also before the camera was ever pointed anywhere.
   */
  view(): PixelRect {
    const { width, height, zoom } = this.camera;
    // Phaser keeps the scroll inside the bounds only when it renders; until then it may lie outside them (before the first `lookAt`, after a resize).
    const scrollX = this.camera.useBounds ? this.camera.clampX(this.camera.scrollX) : this.camera.scrollX;
    const scrollY = this.camera.useBounds ? this.camera.clampY(this.camera.scrollY) : this.camera.scrollY;
    return { x: scrollX + (width - width / zoom) / 2, y: scrollY + (height - height / zoom) / 2, width: width / zoom, height: height / zoom };
  }

  /** How much of the map is on screen, in tiles: the view, less what of it lies past the map's edges. */
  tilesInView(): { across: number; down: number } {
    const view = this.view();
    const across = Math.min(view.x + view.width, this.map.x + this.map.width) - Math.max(view.x, this.map.x);
    const down = Math.min(view.y + view.height, this.map.y + this.map.height) - Math.max(view.y, this.map.y);
    return { across: Math.max(0, across) / this.tilePixels, down: Math.max(0, down) / this.tilePixels };
  }

  /** Centres the camera on a pixel position, as far as the map bounds allow. */
  lookAt(x: number, y: number): void {
    const camera = this.camera;
    camera.centerOn(x, y);
    camera.setScroll(
      snapViewToDevicePixels(camera.scrollX, camera.width, camera.zoom),
      snapViewToDevicePixels(camera.scrollY, camera.height, camera.zoom),
    );
  }

  /** Tells Phaser what the camera may not look past, for the zoom and the canvas as they are now. */
  private keepInsideMap(): void {
    const { width, height, zoom } = this.camera;
    const across = boundsAlongAxis({ mapStart: this.map.x, mapLength: this.map.width, viewLength: width / zoom });
    const down = boundsAlongAxis({ mapStart: this.map.y, mapLength: this.map.height, viewLength: height / zoom });
    this.camera.setBounds(across.start, down.start, across.length, down.length);
  }
}

export function cameraView(camera: Phaser.Cameras.Scene2D.Camera): CameraView {
  const bounds = camera.getBounds();
  const worldView = camera.worldView;
  return {
    zoom: camera.zoom,
    scrollX: camera.scrollX,
    scrollY: camera.scrollY,
    width: camera.width,
    height: camera.height,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    worldView: { x: worldView.x, y: worldView.y, width: worldView.width, height: worldView.height },
    visibleMetres: { width: camera.width / camera.zoom / PIXELS_PER_METRE, height: camera.height / camera.zoom / PIXELS_PER_METRE },
  };
}

/**
 * Moves a scroll value so the view's top-left corner lands on a whole device
 * pixel. Otherwise every texture pixel straddles two screen pixels and the
 * art shimmers as the camera moves. Phaser zooms around the canvas centre,
 * so the top-left corner of the view sits at `scroll + size / 2 - size / (2 * zoom)`.
 */
function snapViewToDevicePixels(scroll: number, size: number, zoom: number): number {
  const centreOffset = (size - size / zoom) / 2;
  const topLeft = scroll + centreOffset;
  return Math.round(topLeft * zoom) / zoom - centreOffset;
}

/**
 * The stretch a camera is kept inside along one axis. That is the map, while
 * the map is longer than the view. A view longer than the map would be
 * pinned to the map's start by Phaser, leaving all the empty space on one
 * side; the stretch is then as long as the view, with the map in its middle.
 */
function boundsAlongAxis({ mapStart, mapLength, viewLength }: { mapStart: number; mapLength: number; viewLength: number }): { start: number; length: number } {
  if (!(viewLength > mapLength)) return { start: mapStart, length: mapLength };
  return { start: mapStart - (viewLength - mapLength) / 2, length: viewLength };
}

export const __testing__ = { snapViewToDevicePixels, boundsAlongAxis };
