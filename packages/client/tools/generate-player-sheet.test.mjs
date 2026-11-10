import { avatarDefIds, getDef } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { AVATAR_PALETTES, DIRECTIONS, FRAME_HEIGHT, FRAME_WIDTH, FRAMES_PER_DIRECTION, paintPlayerSheet } from './generate-player-sheet.mjs';

describe('avatar sheet generator', () => {
  it('has one palette per avatar def, under the sprite key the def declares', () => {
    const keys = avatarDefIds.map((defId) => getDef(defId).sprite?.key);
    expect([...Object.keys(AVATAR_PALETTES)].sort()).toEqual([...keys].sort());
  });

  it("paints each avatar's shirt in the colour its def carries for the flat-shape fallback", () => {
    for (const defId of avatarDefIds) {
      const def = getDef(defId);
      const [r, g, b] = AVATAR_PALETTES[def.sprite?.key ?? ''].shirt;
      expect((r << 16) | (g << 8) | b, def.name).toBe(def.color);
    }
  });

  it('paints sheets in the frame layout the defs declare', () => {
    for (const defId of avatarDefIds) {
      const sprite = getDef(defId).sprite;
      const sheet = paintPlayerSheet(AVATAR_PALETTES[sprite.key]);
      expect(sheet.width).toBe(sprite.frameWidth * FRAMES_PER_DIRECTION);
      expect(sheet.height).toBe(sprite.frameHeight * DIRECTIONS.length);
      expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([sprite.frameWidth, sprite.frameHeight]);
      for (const direction of DIRECTIONS) {
        const frames = sprite.directions[direction];
        expect(Math.floor(frames.idle / FRAMES_PER_DIRECTION)).toBe(DIRECTIONS.indexOf(direction));
        expect(frames.walk.end - frames.walk.start + 1).toBe(FRAMES_PER_DIRECTION);
      }
    }
  });
});
