import { characterPalettes, DefId, getDef } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { __testing__ as characterSheet, paintLook } from '../src/render/characterSheet.ts';
import { __testing__ as generator, DIRECTIONS, FIXED_PALETTE, FRAME_HEIGHT, FRAME_WIDTH, FRAMES_PER_DIRECTION, paintPlayerSheet, PLAYER_SHEET_KEY, TEMPLATE_PALETTE } from './generate-player-sheet.mjs';

describe('player sheet generator', () => {
  it('writes the sheet under the sprite key the player def declares', () => {
    expect(getDef(DefId.Player).sprite?.key).toBe(PLAYER_SHEET_KEY);
  });

  it('paints in the template colours the client swaps, and uses them for nothing else', () => {
    expect(characterSheet.TEMPLATE_COLORS).toEqual({
      skin: rgb(TEMPLATE_PALETTE.skin),
      skinShade: rgb(TEMPLATE_PALETTE.skinShade),
      hair: rgb(TEMPLATE_PALETTE.hair),
      hairShade: rgb(TEMPLATE_PALETTE.hairShade),
      hairLight: rgb(TEMPLATE_PALETTE.hairLight),
      clothes: rgb(TEMPLATE_PALETTE.clothes),
      clothesShade: rgb(TEMPLATE_PALETTE.clothesShade),
      clothesLight: rgb(TEMPLATE_PALETTE.clothesLight),
    });
    const swapped = Object.values(TEMPLATE_PALETTE).map(rgb);
    const fixed = Object.values(FIXED_PALETTE).map(rgb);
    expect(new Set([...swapped, ...fixed]).size).toBe(swapped.length + fixed.length);
    // Every swapped colour is really in the sheet, so a look changes every shade of every part.
    const painted = paintedColors(paintPlayerSheet());
    for (const color of swapped) expect(painted.has(color)).toBe(true);
    // And nothing is painted in a colour neither palette names.
    for (const color of painted) expect([...swapped, ...fixed]).toContain(color);
  });

  it('derives the template\'s own shades from its base colours the way the client derives a look\'s', () => {
    const { highlightOf, shadeOf } = characterSheet;
    expect(rgb(TEMPLATE_PALETTE.skinShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.skin)));
    expect(rgb(TEMPLATE_PALETTE.hairShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.hair)));
    expect(rgb(TEMPLATE_PALETTE.hairLight)).toBe(highlightOf(rgb(TEMPLATE_PALETTE.hair)));
    expect(rgb(TEMPLATE_PALETTE.clothesShade)).toBe(shadeOf(rgb(TEMPLATE_PALETTE.clothes)));
    expect(rgb(TEMPLATE_PALETTE.clothesLight)).toBe(highlightOf(rgb(TEMPLATE_PALETTE.clothes)));
  });

  it('recolours every pixel of every part in all sixteen frames for every look', () => {
    const sheet = paintPlayerSheet();
    const template = new Uint8ClampedArray(sheet.data);
    const partOfColor = new Map(Object.entries(characterSheet.TEMPLATE_COLORS).map(([part, color]) => [color, part]));
    let looks = 0;
    for (let skin = 0; skin < characterPalettes.skin.length; skin += 1) {
      for (let hair = 0; hair < characterPalettes.hair.length; hair += 1) {
        for (let clothes = 0; clothes < characterPalettes.clothes.length; clothes += 1) {
          const look = { skin, hair, clothes };
          const expected = characterSheet.lookColors(look);
          const pixels = new Uint8ClampedArray(template);
          paintLook(pixels, look);
          let wrong = 0;
          for (let offset = 0; offset < template.length; offset += 4) {
            const before = rgb(template.subarray(offset, offset + 3));
            const after = rgb(pixels.subarray(offset, offset + 3));
            const part = template[offset + 3] === 255 ? partOfColor.get(before) : undefined;
            if (after !== (part ? expected[part] : before) || pixels[offset + 3] !== template[offset + 3]) wrong += 1;
          }
          expect(wrong, `look ${JSON.stringify(look)}`).toBe(0);
          looks += 1;
        }
      }
    }
    expect(looks).toBe(characterPalettes.skin.length * characterPalettes.hair.length * characterPalettes.clothes.length);
  });

  it('keeps every hairstyle on a layer of its own, over a body that carries no hair', () => {
    const hairColors = new Set([TEMPLATE_PALETTE.hair, TEMPLATE_PALETTE.hairShade, TEMPLATE_PALETTE.hairLight].map(rgb));
    for (const hairstyle of Object.keys(generator.HAIRSTYLES)) {
      for (const direction of DIRECTIONS) {
        for (const pose of generator.POSES) {
          const { body, hair } = generator.paintFrameLayers(direction, pose, hairstyle);
          expect(paintedColors(hair).size).toBeGreaterThan(0);
          for (const color of paintedColors(hair)) expect(hairColors).toContain(color);
          // The body carries no hair but the eyebrows (in the hair's shade), so taking the hair layer away leaves a bald head.
          expect(paintedColors(body).has(rgb(TEMPLATE_PALETTE.hair))).toBe(false);
          expect(paintedColors(body).has(rgb(TEMPLATE_PALETTE.hairLight))).toBe(false);
        }
      }
    }
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

  it('leaves a clear pixel on every edge of every frame, outline included, so frames never bleed into each other', () => {
    const sheet = paintPlayerSheet();
    const touching = [];
    for (let y = 0; y < sheet.height; y += 1) {
      for (let x = 0; x < sheet.width; x += 1) {
        const onFrameEdge = [0, FRAME_WIDTH - 1].includes(x % FRAME_WIDTH) || [0, FRAME_HEIGHT - 1].includes(y % FRAME_HEIGHT);
        if (onFrameEdge && sheet.data[(y * sheet.width + x) * 4 + 3] !== 0) touching.push([x, y]);
      }
    }
    expect(touching).toEqual([]);
  });
});

// ---- Helpers ----

function rgb([r, g, b]) {
  return (r << 16) | (g << 8) | b;
}

function paintedColors(canvas) {
  const painted = new Set();
  for (let offset = 0; offset < canvas.data.length; offset += 4) {
    if (canvas.data[offset + 3] === 255) painted.add(rgb(canvas.data.subarray(offset, offset + 3)));
  }
  return painted;
}
