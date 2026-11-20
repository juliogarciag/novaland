import { characterPalettes } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { __testing__, cssColor, lookKey, paintLook } from './characterSheet';

describe('painting a look over the template sheet', () => {
  it('swaps each template colour for the look\'s and leaves every other pixel alone', () => {
    const look = { skin: 4, hair: 6, clothes: 1 };
    const outline = 0x1f1a17;
    const pixels = rgba([...Object.values(TEMPLATE_COLORS), outline]);
    paintLook(pixels, look);
    const skin = characterPalettes.skin[4].color;
    const hair = characterPalettes.hair[6].color;
    const clothes = characterPalettes.clothes[1].color;
    expect(colorsOf(pixels)).toEqual([
      skin,
      shadeOf(skin),
      hair,
      shadeOf(hair),
      lightOf(hair),
      clothes,
      shadeOf(clothes),
      lightOf(clothes),
      outline,
    ]);
  });

  it('does not repaint transparent pixels, whatever colour they carry', () => {
    const pixels = rgba([TEMPLATE_COLORS.skin]);
    pixels[3] = 0;
    paintLook(pixels, { skin: 5, hair: 0, clothes: 0 });
    expect(colorsOf(pixels)).toEqual([TEMPLATE_COLORS.skin]);
  });

  it('gives two looks different colours and different keys, and the same look the same key', () => {
    const one = { skin: 0, hair: 0, clothes: 0 };
    const other = { skin: 1, hair: 0, clothes: 0 };
    expect(lookColors(one)).not.toEqual(lookColors(other));
    expect(lookKey(one)).not.toBe(lookKey(other));
    expect(lookKey(one)).toBe(lookKey({ ...one }));
  });

  it('falls back to the template colours for an index outside a palette instead of failing in the draw loop', () => {
    expect(lookColors({ skin: 99, hair: -1, clothes: 1.5 })).toEqual(TEMPLATE_COLORS);
  });

  it('gives every swatch a shade darker and a highlight lighter than itself, so each part keeps its shading in every look', () => {
    for (const swatches of Object.values(characterPalettes)) {
      for (const { color } of swatches) {
        expect(shadeOf(color)).not.toBe(color);
        expect(lightOf(color)).not.toBe(color);
        expect(brightness(shadeOf(color))).toBeLessThan(brightness(color));
        expect(brightness(lightOf(color))).toBeGreaterThan(brightness(color));
      }
    }
  });

  it('shades and lights channel by channel, clamped to the colour range, and writes colours the way CSS reads them', () => {
    expect(shadeOf(0xffffff)).toBe(0xbfbfbf);
    expect(shadeOf(0x000000)).toBe(0x000000);
    expect(lightOf(0x000000)).toBe(0x1a1a1a);
    expect(lightOf(0xffffff)).toBe(0xffffff);
    expect(lightOf(0xf3e5ab)).toBe(0xffffe7);
    expect(cssColor(0x0d9488)).toBe('#0d9488');
    expect(cssColor(0x00000f)).toBe('#00000f');
  });
});

// ---- Helpers ----

const { lightOf, lookColors, shadeOf, TEMPLATE_COLORS } = __testing__;

function rgba(colors: readonly number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap((color) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 255]));
}

function colorsOf(pixels: Uint8ClampedArray): number[] {
  const colors: number[] = [];
  for (let offset = 0; offset < pixels.length; offset += 4) colors.push(((pixels[offset] as number) << 16) | ((pixels[offset + 1] as number) << 8) | (pixels[offset + 2] as number));
  return colors;
}

function brightness(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}
