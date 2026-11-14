import { terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { GRASS_COLORS } from './generate-grass-sheet.mjs';
import { FRAME_HEIGHT, FRAME_WIDTH, ROCK_SPRITE_KEY, ROCK_VARIANT_COUNT, paintRockSheet } from './generate-rock-sheet.mjs';

describe('rock sheet generator', () => {
  it('paints the sheet under the key and in the frame layout the rock def declares', () => {
    const standingSprite = terrainDefs.find((def) => def.name === 'rock')?.standingSprite;
    expect(standingSprite).toMatchObject({ key: ROCK_SPRITE_KEY, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT, variantCount: ROCK_VARIANT_COUNT });
    const sheet = paintRockSheet();
    expect([sheet.width, sheet.height]).toEqual([FRAME_WIDTH * ROCK_VARIANT_COUNT, FRAME_HEIGHT]);
  });

  it('paints the same sheet every time', () => {
    expect(paintRockSheet().data).toEqual(paintRockSheet().data);
  });

  it('keeps every rock inside the width of its one-metre tile', () => {
    const { pixelsPerMetre } = terrainDefs.find((def) => def.name === 'rock').standingSprite;
    expect(FRAME_WIDTH).toBeLessThanOrEqual(pixelsPerMetre);
  });

  it('paints a rock in every frame, and no two alike', () => {
    const frames = Array.from({ length: ROCK_VARIANT_COUNT }, (_, variant) => opaquePixelsOfFrame(paintRockSheet(), variant));
    for (const frame of frames) expect(frame.length).toBeGreaterThan(80);
    expect(new Set(frames.map((frame) => frame.map((pixel) => `${pixel.x},${pixel.y},${pixel.colour}`).join(' '))).size).toBe(ROCK_VARIANT_COUNT);
  });

  it('buries every rock: its lowest row is grass in the greens of the grass sheet, with nothing under it', () => {
    const grassGreens = new Set(Object.values(GRASS_COLORS).map((colour) => colour.join(',')));
    for (let variant = 0; variant < ROCK_VARIANT_COUNT; variant += 1) {
      const pixels = opaquePixelsOfFrame(paintRockSheet(), variant);
      const lowestRow = Math.max(...pixels.map((pixel) => pixel.y));
      const foot = pixels.filter((pixel) => pixel.y === lowestRow);
      expect(foot.length, `variant ${variant}`).toBeGreaterThanOrEqual(6);
      for (const pixel of foot) expect(grassGreens.has(pixel.colour), `variant ${variant}, column ${pixel.x}`).toBe(true);
    }
  });
});

// ---- Helpers ----

/** The opaque pixels of one frame of the sheet: where they are in the frame and their colour as `r,g,b`. */
function opaquePixelsOfFrame(sheet, variant) {
  const pixels = [];
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const offset = (y * sheet.width + variant * FRAME_WIDTH + x) * 4;
      if (sheet.data[offset + 3] === 255) pixels.push({ x, y, colour: `${sheet.data[offset]},${sheet.data[offset + 1]},${sheet.data[offset + 2]}` });
    }
  }
  return pixels;
}
