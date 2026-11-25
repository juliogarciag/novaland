import { characterPalettes, characterShapes, type CharacterLook } from '@novaland/sim';

/**
 * The colours `sprites/player.png` and the layer sheets are painted in, as
 * 0xRRGGBB: the ones a player's look replaces. They must match
 * TEMPLATE_PALETTE in tools/generate-player-sheet.mjs (the generator's test
 * checks it).
 */
const TEMPLATE_COLORS = {
  skin: 0xf1c27d,
  hair: 0x6b3e1e,
  clothes: 0x3b82f6,
  // Hand-picked in c466e78's sheet, not shadeOf(clothes): keeping it keeps player.png that sheet byte for byte (ADR 0019). A look's shade is derived.
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
  return `${look.skin}-${look.hair}-${look.clothes}-${look.gender}-${look.hairStyle}`;
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

/** The colour of the figure's edge, as 0xRRGGBB: FIXED_PALETTE.outline in tools/generate-player-sheet.mjs (the generator's test checks it). */
const OUTLINE_COLOR = 0x1f1a17;

/** The sprite keys of the two layer sheets a look is drawn from: its gender's and its hairstyle's (ADR 0018). Undefined for an index outside the lists. */
export function layerSheetsOf(look: CharacterLook): { readonly body: string; readonly hair: string } | undefined {
  const body = characterShapes.gender[look.gender]?.sheet;
  const hair = characterShapes.hairStyle[look.hairStyle]?.sheet;
  return body && hair ? { body, hair } : undefined;
}

/** RGBA bytes of a layer, as a canvas gives them, with their size in pixels. */
export interface LayerPixels {
  readonly body: Uint8ClampedArray;
  readonly hair: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * A look's figure from its two layers, as new RGBA bytes the size of the
 * layers: the hair laid over the body, a one-pixel edge around the two
 * together (any clear pixel beside the figure, as the generator outlines a
 * frame), then the template colours swapped for the look's (`paintLook`).
 * Frames keep a clear border, so outlining a whole sheet at once outlines
 * each frame on its own.
 */
export function paintFigure({ body, hair, width, height }: LayerPixels, look: CharacterLook): Uint8ClampedArray {
  const figure = new Uint8ClampedArray(body);
  for (let offset = 0; offset + 3 < hair.length; offset += 4) {
    if (hair[offset + 3] === 255) figure.set(hair.subarray(offset, offset + 4), offset);
  }
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && figure[(y * width + x) * 4 + 3] === 255;
  const edge: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!opaque(x, y) && (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1))) edge.push((y * width + x) * 4);
    }
  }
  for (const offset of edge) figure.set([(OUTLINE_COLOR >> 16) & 0xff, (OUTLINE_COLOR >> 8) & 0xff, OUTLINE_COLOR & 0xff, 255], offset);
  paintLook(figure, look);
  return figure;
}

/** A colour as the CSS hex string a style takes. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const __testing__ = { lookColors, OUTLINE_COLOR, shadeOf, TEMPLATE_COLORS };
