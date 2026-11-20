import { PIXELS_PER_METRE } from './units';

/** Metres that must always fit across the window, whatever its size. */
export const MIN_VISIBLE_METRES = 20;

/**
 * The camera zoom for a canvas this many device pixels wide: the largest whole
 * number at which at least `MIN_VISIBLE_METRES` are visible horizontally, and
 * never less than 1. Whole numbers keep every texture pixel the same size on
 * screen, which is what makes pixel art look crisp.
 *
 * The rule is in metres, so the art's pixels per metre only changes which
 * whole numbers there are to pick from: at 32 pixels per metre a screen gets
 * half the zoom it got at 16 and sees the same metres, except where the zoom
 * at 16 was odd (2k + 1), which now rounds down to k and shows more of the
 * world: up to half as much again, for canvases 960 to 1279 pixels wide.
 */
export function wholeZoomFor(canvasWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return 1;
  return Math.max(1, Math.floor(canvasWidth / (PIXELS_PER_METRE * MIN_VISIBLE_METRES)));
}
