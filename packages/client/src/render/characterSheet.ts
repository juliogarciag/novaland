import { characterPalettes, type CharacterLook } from '@novaland/sim';

/**
 * The colours `sprites/player.png` is painted in, as 0xRRGGBB: the ones a
 * player's look replaces. They must match TEMPLATE_PALETTE in
 * tools/generate-player-sheet.mjs (the generator's test checks it). A look
 * picks one colour per part; each part's shade and highlight are derived from
 * it, so every swatch of `characterPalettes` gets matching shades.
 */
const TEMPLATE_COLORS = {
  skin: 0xf1c27d,
  skinShade: 0xb5925e,
  hair: 0x6b3e1e,
  hairShade: 0x502f17,
  hairLight: 0x9a643e,
  clothes: 0x3b82f6,
  clothesShade: 0x2c62b9,
  clothesLight: 0x60b6ff,
} as const;

type TemplatePart = keyof typeof TEMPLATE_COLORS;

/** How dark a shade is, as a fraction of each channel of the colour. */
const SHADE = 0.75;
/** How a highlight brightens a colour: each channel is multiplied by `gain`, then raised by `lift` of the full range. Lifting keeps a highlight visible on near-black hair. */
const LIGHT = { gain: 1.2, lift: 0.1 } as const;

/** The colours a look paints the template with, as 0xRRGGBB. */
function lookColors(look: CharacterLook): Record<TemplatePart, number> {
  const skin = characterPalettes.skin[look.skin]?.color ?? TEMPLATE_COLORS.skin;
  const hair = characterPalettes.hair[look.hair]?.color ?? TEMPLATE_COLORS.hair;
  const clothes = characterPalettes.clothes[look.clothes]?.color ?? TEMPLATE_COLORS.clothes;
  return {
    skin,
    skinShade: shadeOf(skin),
    hair,
    hairShade: shadeOf(hair),
    hairLight: lightOf(hair),
    clothes,
    clothesShade: shadeOf(clothes),
    clothesLight: lightOf(clothes),
  };
}

/** A darker shade of a colour, channel by channel. */
function shadeOf(color: number): number {
  return mapChannels(color, (channel) => channel * SHADE);
}

/** A lighter tint of a colour, channel by channel, clamped to white. */
function lightOf(color: number): number {
  return mapChannels(color, (channel) => Math.min(255, channel * LIGHT.gain + 255 * LIGHT.lift));
}

function mapChannels(color: number, map: (channel: number) => number): number {
  const channel = (shift: number): number => Math.round(map((color >> shift) & 0xff)) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** One name per look, for texture and animation keys: two players with the same look share a texture. */
export function lookKey(look: CharacterLook): string {
  return `${look.skin}-${look.hair}-${look.clothes}`;
}

/**
 * Repaints template pixels (RGBA bytes, as a canvas gives them) in a look's
 * colours, in place: every opaque pixel in a template colour takes the
 * matching colour of the look, everything else stays as it is.
 */
export function paintLook(pixels: Uint8ClampedArray, look: CharacterLook): void {
  const colors = lookColors(look);
  const swaps = new Map<number, number>();
  for (const part of Object.keys(TEMPLATE_COLORS) as TemplatePart[]) swaps.set(TEMPLATE_COLORS[part], colors[part]);
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

export const __testing__ = { lightOf, lookColors, shadeOf, TEMPLATE_COLORS };
