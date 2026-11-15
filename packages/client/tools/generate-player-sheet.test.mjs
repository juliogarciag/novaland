import { DefId, getDef } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_COLORS } from '../src/render/characterSheet.ts';
import { DIRECTIONS, FIXED_PALETTE, FRAME_HEIGHT, FRAME_WIDTH, FRAMES_PER_DIRECTION, paintPlayerSheet, PLAYER_SHEET_KEY, TEMPLATE_PALETTE } from './generate-player-sheet.mjs';

describe('player sheet generator', () => {
  it('writes the sheet under the sprite key the player def declares', () => {
    expect(getDef(DefId.Player).sprite?.key).toBe(PLAYER_SHEET_KEY);
  });

  it('paints in the template colours the client swaps, and uses them for nothing else', () => {
    expect(TEMPLATE_COLORS).toEqual({
      skin: rgb(TEMPLATE_PALETTE.skin),
      hair: rgb(TEMPLATE_PALETTE.hair),
      clothes: rgb(TEMPLATE_PALETTE.shirt),
      clothesShade: rgb(TEMPLATE_PALETTE.shirtShade),
    });
    const swapped = Object.values(TEMPLATE_PALETTE).map(rgb);
    const fixed = Object.values(FIXED_PALETTE).map(rgb);
    expect(new Set([...swapped, ...fixed]).size).toBe(swapped.length + fixed.length);
    // Every swapped colour is really in the sheet, so a look changes all three parts.
    const painted = new Set();
    const sheet = paintPlayerSheet();
    for (let offset = 0; offset < sheet.data.length; offset += 4) {
      if (sheet.data[offset + 3] === 255) painted.add(rgb([sheet.data[offset], sheet.data[offset + 1], sheet.data[offset + 2]]));
    }
    for (const color of swapped) expect(painted.has(color)).toBe(true);
  });

  it('paints the sheet in the frame layout the def declares', () => {
    const sprite = getDef(DefId.Player).sprite;
    const sheet = paintPlayerSheet();
    expect(sheet.width).toBe(sprite.frameWidth * FRAMES_PER_DIRECTION);
    expect(sheet.height).toBe(sprite.frameHeight * DIRECTIONS.length);
    expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([sprite.frameWidth, sprite.frameHeight]);
    for (const direction of DIRECTIONS) {
      const frames = sprite.directions[direction];
      expect(Math.floor(frames.idle / FRAMES_PER_DIRECTION)).toBe(DIRECTIONS.indexOf(direction));
      expect(frames.walk.end - frames.walk.start + 1).toBe(FRAMES_PER_DIRECTION);
    }
  });
});

// ---- Helpers ----

function rgb([r, g, b]) {
  return (r << 16) | (g << 8) | b;
}
