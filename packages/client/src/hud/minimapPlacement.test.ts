import { describe, expect, it } from 'vitest';
import { wholeZoomFor } from '../render/zoom';
import { HUD_MARGIN, MINIMAP_TILE_CSS_PIXELS, MINIMAP_TILES_ACROSS, minimapPlacement, sameMinimapPlacement } from './minimapPlacement';

describe('minimapPlacement', () => {
  it('sits in the top-right corner, a margin from both edges, beside the HUD lines', () => {
    expect(minimapPlacement({ canvasWidth: 1280, pixelRatio: 1, hudLines: HUD_LINES })).toEqual({ x: 1280 - HUD_MARGIN - CSS_SIZE, y: HUD_MARGIN, size: CSS_SIZE, pixelsPerTile: MINIMAP_TILE_CSS_PIXELS, pixelRatio: 1 });
  });

  it('is the same CSS size at every pixel ratio and every camera zoom, with a tile a whole number of device pixels', () => {
    for (const pixelRatio of [1, 1.25, 1.5, 2, 3]) {
      for (const cssWidth of [640, 960, 1280, 1920, 3840]) {
        const canvasWidth = Math.round(cssWidth * pixelRatio);
        const placement = minimapPlacement({ canvasWidth, pixelRatio, hudLines: { right: HUD_LINES.right * pixelRatio, bottom: HUD_LINES.bottom * pixelRatio } });
        const label = `${cssWidth} CSS px at ${pixelRatio}x, camera zoom ${wholeZoomFor(canvasWidth)}`;
        expect(Number.isInteger(placement.pixelsPerTile), label).toBe(true);
        expect(placement.size, label).toBe(MINIMAP_TILES_ACROSS * placement.pixelsPerTile);
        // Within a device pixel per tile of the CSS size it is meant to have.
        expect(Math.abs(placement.size / pixelRatio - CSS_SIZE), label).toBeLessThanOrEqual(MINIMAP_TILES_ACROSS / (2 * pixelRatio));
        expect(placement.x + placement.size, label).toBe(canvasWidth - Math.round(HUD_MARGIN * pixelRatio));
      }
    }
  });

  it('moves below the HUD lines in a window too narrow to hold both side by side, and never covers them', () => {
    for (let canvasWidth = 200; canvasWidth <= 1400; canvasWidth += 1) {
      const placement = minimapPlacement({ canvasWidth, pixelRatio: 1, hudLines: HUD_LINES });
      const coversLines = placement.x < HUD_LINES.right && placement.y < HUD_LINES.bottom;
      expect(coversLines, `${canvasWidth} px wide`).toBe(false);
      expect(placement.x, `${canvasWidth} px wide`).toBeGreaterThanOrEqual(HUD_MARGIN);
    }
    expect(minimapPlacement({ canvasWidth: 480, pixelRatio: 1, hudLines: HUD_LINES }).y).toBe(HUD_LINES.bottom + HUD_MARGIN);
    expect(minimapPlacement({ canvasWidth: HUD_LINES.right + 2 * HUD_MARGIN + CSS_SIZE, pixelRatio: 1, hudLines: HUD_LINES }).y).toBe(HUD_MARGIN);
  });

  it('falls back to a pixel ratio of 1 for one that is not a positive number', () => {
    for (const pixelRatio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sameMinimapPlacement(minimapPlacement({ canvasWidth: 1280, pixelRatio, hudLines: HUD_LINES }), minimapPlacement({ canvasWidth: 1280, pixelRatio: 1, hudLines: HUD_LINES })), String(pixelRatio)).toBe(true);
    }
  });
});

// ---- Helpers ----

const CSS_SIZE = MINIMAP_TILES_ACROSS * MINIMAP_TILE_CSS_PIXELS;
/** The HUD lines' backdrop as it is online, in CSS pixels: the widest it gets. */
const HUD_LINES = { right: 12 + 330, bottom: 12 + 56 };
