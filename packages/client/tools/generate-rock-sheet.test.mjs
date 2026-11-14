import { terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
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
});
