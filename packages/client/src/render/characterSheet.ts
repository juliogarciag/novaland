import { characterPalettes, type CharacterLook } from '@novaland/sim';

/**
 * The colours `sprites/player.png` is painted in, as 0xRRGGBB: the ones a
 * player's look replaces. They must match TEMPLATE_PALETTE in
 * tools/generate-player-sheet.mjs (the generator's test checks it).
 */
const TEMPLATE_COLORS = {
  skin: 0xf1c27d,
  hair: 0x6b3e1e,
  clothes: 0x3b82f6,
  clothesShade: 0x2a5fc0,
} as const;

/** How dark the shaded side of the clothes is, as a fraction of the clothes colour. */
const SHADE = 0.75;

/** The colours a look paints the template with, as 0xRRGGBB. */
function lookColors(look: CharacterLook): Record<keyof typeof TEMPLATE_COLORS, number> {
  const clothes = characterPalettes.clothes[look.clothes]?.color ?? TEMPLATE_COLORS.clothes;
  return {
    skin: characterPalettes.skin[look.skin]?.color ?? TEMPLATE_COLORS.skin,
    hair: characterPalettes.hair[look.hair]?.color ?? TEMPLATE_COLORS.hair,
    clothes,
    clothesShade: shadeOf(clothes),
  };
}

/** A darker shade of a colour, channel by channel. */
function shadeOf(color: number): number {
  const shade = (channel: number): number => Math.round(channel * SHADE);
  return (shade((color >> 16) & 0xff) << 16) | (shade((color >> 8) & 0xff) << 8) | shade(color & 0xff);
}

/** One name per look, for texture and animation keys: two players with the same look share a texture. */
export function lookKey(look: CharacterLook): string {
  return `${look.skin}-${look.hair}-${look.clothes}-${look.body}-${look.hairStyle}`;
}

/**
 * Repaints template pixels (RGBA bytes, as a canvas gives them) in a look's
 * colours, in place: every opaque pixel in a template colour takes the
 * matching colour of the look, everything else stays as it is.
 */
export function paintLook(pixels: Uint8ClampedArray, look: CharacterLook): void {
  const colors = lookColors(look);
  const swaps = new Map<number, number>();
  for (const part of Object.keys(TEMPLATE_COLORS) as (keyof typeof TEMPLATE_COLORS)[]) swaps.set(TEMPLATE_COLORS[part], colors[part]);
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if (pixels[offset + 3] !== 255) continue;
    const swap = swaps.get(((pixels[offset] as number) << 16) | ((pixels[offset + 1] as number) << 8) | (pixels[offset + 2] as number));
    if (swap === undefined) continue;
    pixels[offset] = (swap >> 16) & 0xff;
    pixels[offset + 1] = (swap >> 8) & 0xff;
    pixels[offset + 2] = swap & 0xff;
  }
}

/** A colour as the CSS hex string a style takes. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const __testing__ = { lookColors, shadeOf, TEMPLATE_COLORS };
