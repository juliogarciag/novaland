import { terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { GRASS_SPRITE_KEY, GRASS_VARIANT_COUNT, TILE_PIXELS, paintGrassSheet } from './generate-grass-sheet.mjs';

describe('grass sheet generator', () => {
  it('paints the sheet under the key and in the tile layout the grass def declares', () => {
    const groundSprite = terrainDefs.find((def) => def.name === 'grass')?.groundSprite;
    expect(groundSprite).toEqual({ key: GRASS_SPRITE_KEY, tilePixels: TILE_PIXELS, variantCount: GRASS_VARIANT_COUNT });
    const sheet = paintGrassSheet();
    expect([sheet.width, sheet.height]).toEqual([TILE_PIXELS * GRASS_VARIANT_COUNT, TILE_PIXELS]);
  });

  it('paints the same sheet every time', () => {
    expect(paintGrassSheet().data).toEqual(paintGrassSheet().data);
  });

  it('covers every pixel: ground has no holes', () => {
    const { data } = paintGrassSheet();
    for (let offset = 3; offset < data.length; offset += 4) expect(data[offset]).toBe(255);
  });

  it('textures every tile and paints no two alike', () => {
    const sheet = paintGrassSheet();
    const tiles = Array.from({ length: GRASS_VARIANT_COUNT }, (_, variant) => coloursOfTile(sheet, variant));
    for (const tile of tiles) expect(new Set(tile).size).toBeGreaterThanOrEqual(3);
    expect(new Set(tiles.map((tile) => tile.join(' '))).size).toBe(GRASS_VARIANT_COUNT);
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
