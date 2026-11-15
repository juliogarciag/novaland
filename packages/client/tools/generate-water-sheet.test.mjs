import { terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { TILE_PIXELS, WATER_COLORS, WATER_SPRITE_KEY, WATER_VARIANT_COUNT, paintWaterSheet } from './generate-water-sheet.mjs';

describe('water sheet generator', () => {
  it('paints the sheet under the key and in the tile layout the water def declares', () => {
    const groundSprite = terrainDefs.find((def) => def.name === 'water')?.groundSprite;
    expect(groundSprite).toEqual({ key: WATER_SPRITE_KEY, tilePixels: TILE_PIXELS, variantCount: WATER_VARIANT_COUNT });
    const sheet = paintWaterSheet();
    expect([sheet.width, sheet.height]).toEqual([TILE_PIXELS * WATER_VARIANT_COUNT, TILE_PIXELS]);
  });

  it('paints the same sheet every time', () => {
    expect(paintWaterSheet().data).toEqual(paintWaterSheet().data);
  });

  it('covers every pixel: water has no holes', () => {
    const { data } = paintWaterSheet();
    for (let offset = 3; offset < data.length; offset += 4) expect(data[offset]).toBe(255);
  });

  it('is mostly the colour the water def falls back to, so a lake looks the same blue with or without the sheet', () => {
    const [red, green, blue] = WATER_COLORS.water;
    const waterDef = terrainDefs.find((def) => def.name === 'water');
    expect(waterDef?.color).toBe((red << 16) | (green << 8) | blue);
    const sheet = paintWaterSheet();
    for (let variant = 0; variant < WATER_VARIANT_COUNT; variant += 1) {
      const colours = coloursOfTile(sheet, variant);
      expect(colours.filter((colour) => colour === `${red},${green},${blue}`).length / colours.length).toBeGreaterThan(0.8);
    }
  });

  it('ripples every tile, paints no two alike, and keeps the edge of every tile plain so tiles join without a seam', () => {
    const sheet = paintWaterSheet();
    const plainWater = WATER_COLORS.water.join(',');
    const tiles = Array.from({ length: WATER_VARIANT_COUNT }, (_, variant) => coloursOfTile(sheet, variant));
    for (const tile of tiles) {
      expect(new Set(tile).size).toBeGreaterThanOrEqual(3);
      const edge = tile.filter((_, index) => index % TILE_PIXELS === 0 || index % TILE_PIXELS === TILE_PIXELS - 1 || index < TILE_PIXELS || index >= TILE_PIXELS * (TILE_PIXELS - 1));
      expect(new Set(edge)).toEqual(new Set([plainWater]));
    }
    expect(new Set(tiles.map((tile) => tile.join(' '))).size).toBe(WATER_VARIANT_COUNT);
  });
});

// ---- Helpers ----

/** The colour of every pixel of one tile of the sheet, as `r,g,b` strings, row by row. */
function coloursOfTile(sheet, variant) {
  const colours = [];
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      const offset = (y * sheet.width + variant * TILE_PIXELS + x) * 4;
      colours.push(`${sheet.data[offset]},${sheet.data[offset + 1]},${sheet.data[offset + 2]}`);
    }
  }
  return colours;
}
