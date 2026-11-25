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
