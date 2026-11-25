import { NEAREST_ZOOM_DRAWN_AS_ART } from './terrainDetail';
import { PIXELS_PER_METRE } from './units';

/** Metres that must always fit across the window, whatever its size. */
export const MIN_VISIBLE_METRES = 20;

/**
 * The camera zoom for a canvas this many device pixels wide: the largest whole
 * number at which at least `MIN_VISIBLE_METRES` are visible horizontally, and
 * never less than 1. Whole numbers keep every texture pixel the same size on
 * screen, which is what makes pixel art look crisp.
 */
export function wholeZoomFor(canvasWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return 1;
  return Math.max(1, Math.floor(canvasWidth / (PIXELS_PER_METRE * MIN_VISIBLE_METRES)));
}

/**
 * The furthest out the camera ever goes: a tile is one device pixel. Further
 * out a tile would be less than a pixel, and what is on screen would grow
 * with the size of the world instead of with the size of the window.
 */
const FURTHEST_ZOOM = 1 / PIXELS_PER_METRE;

/** A level this close above the last one is left out, so the last two wheel steps never look the same. */
const SMALLEST_STEP = 1.25;

interface ZoomLevelsOptions {
  /** The canvas, in device pixels. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** The map, in world pixels. */
  readonly mapWidth: number;
  readonly mapHeight: number;
}

/**
 * The zooms the mouse wheel steps through, nearest first. The first is the
 * normal view (`wholeZoomFor`); every step out shows about twice as much,
 * and the last one shows the whole map, or as much of it as `FURTHEST_ZOOM`
 * allows. A map that already fits in the normal view has that one level.
 *
 * Levels of 1 and above are whole numbers, so texture pixels stay whole
 * device pixels. Below 1 they are 1/2, 1/4, 1/8: one device pixel covers a
 * whole block of texture pixels, so every tile still takes the same number
 * of device pixels as its neighbours. Only the last level may be any
 * fraction, the one that fits the map to the window exactly, and only where
 * the ground is drawn as one colour per tile (render/terrainDetail.ts) and
 * there is no art to keep crisp. A map small enough to fit while its art is
 * still drawn gets the nearest crisp zoom that shows all of it instead.
 */
export function zoomLevels({ canvasWidth, canvasHeight, mapWidth, mapHeight }: ZoomLevelsOptions): number[] {
  const normalZoom = wholeZoomFor(canvasWidth);
  if (![canvasWidth, canvasHeight, mapWidth, mapHeight].every((length) => Number.isFinite(length) && length > 0)) return [normalZoom];
  const furthestLevel = furthestZoom(Math.min(canvasWidth / mapWidth, canvasHeight / mapHeight));
  const levels = [normalZoom];
  if (furthestLevel >= normalZoom) return levels;
  for (let zoom = halfOf(normalZoom); zoom >= furthestLevel * SMALLEST_STEP; zoom = halfOf(zoom)) levels.push(zoom);
  levels.push(furthestLevel);
  return levels;
}

/** The last level, for a map that fits the window exactly at the zoom `wholeMap`. */
function furthestZoom(wholeMap: number): number {
  if (wholeMap >= 1) return Math.floor(wholeMap);
  if (wholeMap >= NEAREST_ZOOM_DRAWN_AS_ART) return NEAREST_ZOOM_DRAWN_AS_ART;
  return Math.max(FURTHEST_ZOOM, wholeMap);
}

/** Half a zoom, kept whole while that is 1 or more. */
function halfOf(zoom: number): number {
  return zoom > 1 ? Math.max(1, Math.floor(zoom / 2)) : zoom / 2;
}

export const __testing__ = { FURTHEST_ZOOM };
