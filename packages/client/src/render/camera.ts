import { readMapTiles, type WorldMap } from '@novaland/sim';
import type Phaser from 'phaser';
import type { PixelRect } from './chunkRange';
import { PIXELS_PER_METRE, toPixels } from './units';
import { wholeZoomFor } from './zoom';

/** What a camera is looking at, in pixels. Read by dev tooling and end-to-end checks. */
export interface CameraView {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  /** Canvas size in device pixels. */
  readonly width: number;
  readonly height: number;
  /** The map, as the camera may not look past it. */
  readonly bounds: PixelRect;
  /** The part of the world on screen. */
  readonly worldView: PixelRect;
  readonly visibleMetres: { readonly width: number; readonly height: number };
}

/**
 * A camera that keeps one target in the middle of the screen, never looks
 * past the map (the rectangle that holds every area) and draws texture
 * pixels as whole screen pixels. The zoom is a whole number picked from the
 * canvas width.
 */
export class MapCamera {
  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    map: WorldMap,
  ) {
    const { bounds, tileSize } = readMapTiles(map);
    camera.setBounds(toPixels(bounds.column * tileSize), toPixels(bounds.row * tileSize), toPixels(bounds.width * tileSize), toPixels(bounds.height * tileSize));
  }

  /** Picks the zoom for a canvas this many device pixels wide. Call again whenever the canvas changes size. */
  fitZoomTo(canvasWidth: number): void {
    this.camera.setZoom(wholeZoomFor(canvasWidth));
  }

  /**
   * The part of the world on screen right now, in world pixels. Phaser only
   * refreshes `camera.worldView` when it renders; this is the same rectangle
   * from the scroll and zoom as they are, so it is right straight after `lookAt`.
   */
  view(): PixelRect {
    const { scrollX, scrollY, width, height, zoom } = this.camera;
    return { x: scrollX + (width - width / zoom) / 2, y: scrollY + (height - height / zoom) / 2, width: width / zoom, height: height / zoom };
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

export const __testing__ = { snapViewToDevicePixels };
