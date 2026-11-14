/**
 * Generates the grass sheet at public/sprites/grass.png: GRASS_VARIANT_COUNT
 * tiles side by side, each TILE_PIXELS square. The layout must match the
 * grass's `groundSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * Every tile is grass all over: short blades in a darker and a lighter green
 * than the turf, a few of them with a bright tip, scattered evenly so that
 * any two tiles can sit side by side without a seam and a field reads as
 * one lawn. The tiles differ only in where the blades fall, which is what
 * keeps a field from repeating. Two tiles of the sheet also have a flower.
 * The greens sit between the tree canopy's light tones, so the forest still
 * stands out from the ground.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-grass-sheet.mjs                # writes public/sprites/grass.png
 *   node tools/generate-grass-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { blit, createCanvas, noise, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const GRASS_SPRITE_KEY = 'grass';
export const TILE_PIXELS = 16;
export const GRASS_VARIANT_COUNT = 24;

const COLORS = {
  turfShade: [0x4a, 0x88, 0x40],
  turf: [0x5c, 0x9e, 0x4a],
  bladeLight: [0x6f, 0xb0, 0x52],
  bladeTip: [0x8a, 0xc4, 0x5e],
  whitePetal: [0xf4, 0xf1, 0xe4],
  pinkPetal: [0xf0, 0xb4, 0xc8],
  flowerCentre: [0xe8, 0xb8, 0x3a],
};

/** The tiles of the sheet that carry a flower, by variant: where its centre is in the tile and the colour of its petals. */
const FLOWERS_BY_VARIANT = new Map([
  [5, { x: 9, y: 6, petal: COLORS.whitePetal }],
  [17, { x: 4, y: 11, petal: COLORS.pinkPetal }],
]);

/** Out of every 100 pixels of a tile, how many start a dark blade and how many a light one. */
const DARK_BLADES_PER_HUNDRED = 9;
const LIGHT_BLADES_PER_HUNDRED = 8;

/** The whole sheet: every variant side by side. */
export function paintGrassSheet() {
  const sheet = createCanvas(TILE_PIXELS * GRASS_VARIANT_COUNT, TILE_PIXELS);
  for (let variant = 0; variant < GRASS_VARIANT_COUNT; variant += 1) blit(sheet, paintGrassTile(variant), variant * TILE_PIXELS, 0);
  return sheet;
}

function paintGrassTile(variant) {
  const tile = createCanvas(TILE_PIXELS, TILE_PIXELS);
  const seed = 101 + variant * 7;
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) pixel(tile, x, y, COLORS.turf);
  }
  // Dark blades first, light ones over them: the light reads as blades standing in front of the shade between them.
  forEachBladeFoot({ seed, perHundred: DARK_BLADES_PER_HUNDRED }, (x, y) => paintBlade(tile, { x, y, height: 2, color: COLORS.turfShade }));
  forEachBladeFoot({ seed: seed + 1, perHundred: LIGHT_BLADES_PER_HUNDRED }, (x, y) => {
    const height = noise(x, y, seed + 2) < 0.35 ? 3 : 2;
    paintBlade(tile, { x, y, height, color: COLORS.bladeLight });
    if (noise(x, y, seed + 3) < 0.3) paintBlade(tile, { x, y: y - height + 1, height: 1, color: COLORS.bladeTip });
  });
  const flower = FLOWERS_BY_VARIANT.get(variant);
  if (flower) paintFlower(tile, flower);
  return tile;
}

/** Calls `paint(x, y)` for the pixel each blade of this tile grows from. */
function forEachBladeFoot({ seed, perHundred }, paint) {
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      if (noise(x, y, seed) * 100 < perHundred) paint(x, y);
    }
  }
}

/** A blade one pixel wide growing up from (x, y). What would leave the tile at the top is left out, so tiles need no particular neighbour. */
function paintBlade(tile, { x, y, height, color }) {
  for (let step = 0; step < height; step += 1) {
    if (y - step >= 0) pixel(tile, x, y - step, color);
  }
}

/** Four petals around a centre, on a short stem. */
function paintFlower(tile, { x, y, petal }) {
  pixel(tile, x, y + 2, COLORS.turfShade);
  pixel(tile, x, y - 1, petal);
  pixel(tile, x - 1, y, petal);
  pixel(tile, x + 1, y, petal);
  pixel(tile, x, y + 1, petal);
  pixel(tile, x, y, COLORS.flowerCentre);
}

/** Writes the grass sheet into `directory` as `grass.png` and returns the path. */
export function writeGrassSheet(directory) {
  return writeSheet({ directory, key: GRASS_SPRITE_KEY, sheet: paintGrassSheet() });
}

writeSheetWhenRunDirectly(import.meta.url, writeGrassSheet);
