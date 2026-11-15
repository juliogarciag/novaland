import { HUD_MARGIN } from './layout';

/** Tiles the minimap shows across and down, centred on the player. The camera shows 20 to 40 tiles across (render/zoom.ts), so this is two to four screens. */
export const MINIMAP_TILES_ACROSS = 80;
/** CSS pixels a tile takes on the minimap. A whole number, and the size on screen follows from it: 160 CSS pixels a side. */
export const MINIMAP_TILE_CSS_PIXELS = 2;

/** Where the minimap is on the canvas, in device pixels: its top-left corner, the side of its square, and how many pixels a tile takes. */
export interface MinimapPlacement {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly pixelsPerTile: number;
  /** Device pixels per CSS pixel the placement was made for. */
  readonly pixelRatio: number;
}

export interface MinimapPlacementOptions {
  /** Canvas width in device pixels. */
  readonly canvasWidth: number;
  /** Device pixels per CSS pixel. */
  readonly pixelRatio: number;
  /** The right and bottom edges of the HUD lines' backdrop, in device pixels. They sit in the top-left corner. */
  readonly hudLines: { readonly right: number; readonly bottom: number };
}

/**
 * The minimap sits in the top-right corner, the same CSS size on every
 * screen and at every camera zoom: a tile is a whole number of device
 * pixels, so its colours stay crisp. In a window too narrow to hold it next
 * to the HUD lines it moves below them instead of covering them.
 */
export function minimapPlacement({ canvasWidth, pixelRatio, hudLines }: MinimapPlacementOptions): MinimapPlacement {
  const safePixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const pixelsPerTile = Math.max(1, Math.round(MINIMAP_TILE_CSS_PIXELS * safePixelRatio));
  const size = MINIMAP_TILES_ACROSS * pixelsPerTile;
  const margin = Math.round(HUD_MARGIN * safePixelRatio);
  const x = Math.max(margin, Math.round(canvasWidth) - margin - size);
  const besideHudLines = x >= hudLines.right + margin;
  return { x, y: besideHudLines ? margin : Math.round(hudLines.bottom) + margin, size, pixelsPerTile, pixelRatio: safePixelRatio };
}

export function sameMinimapPlacement(first: MinimapPlacement, second: MinimapPlacement): boolean {
  return first.x === second.x && first.y === second.y && first.size === second.size && first.pixelsPerTile === second.pixelsPerTile && first.pixelRatio === second.pixelRatio;
}
