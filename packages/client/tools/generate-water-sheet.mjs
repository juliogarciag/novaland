/**
 * Generates the water sheet at public/sprites/water.png: WATER_VARIANT_COUNT
 * tiles side by side, each TILE_PIXELS square. The layout must match the
 * water's `groundSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * Every tile is still water all over: one blue, with a few short ripples
 * lying flat on it, some lighter than the water and some darker, and now and
 * then a glint. Ripples never touch the edge of a tile, so any two tiles
 * can sit side by side without a seam and a lake reads as one calm surface.
 * The tiles differ only in where the ripples fall, which is what keeps a
 * lake from repeating. It is a placeholder: no shore, no movement.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-water-sheet.mjs                # writes public/sprites/water.png
 *   node tools/generate-water-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { blit, createCanvas, noise, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const WATER_SPRITE_KEY = 'water';
export const TILE_PIXELS = 16;
export const WATER_VARIANT_COUNT = 8;

/** The blues of a lake. `water` is the def's `color`: what a view without the sheet fills the tile with. */
export const WATER_COLORS = {
  rippleShade: [0x34, 0x72, 0xc0],
  water: [0x3e, 0x82, 0xd2],
  rippleLight: [0x62, 0xa0, 0xe4],
  glint: [0xa6, 0xcc, 0xf2],
};

/**
 * Ripples are dealt out evenly: the tile is cut into bands of this many
 * pixels and every band gets one ripple, somewhere along it. Scattering
 * them freely leaves one tile bare and the next crowded.
 */
const BAND_PIXELS = 4;

/** A ripple is this many pixels long at least and at most, and one pixel tall. */
const SHORTEST_RIPPLE = 3;
const LONGEST_RIPPLE = 5;

/** The whole sheet: every variant side by side. */
export function paintWaterSheet() {
  const sheet = createCanvas(TILE_PIXELS * WATER_VARIANT_COUNT, TILE_PIXELS);
  for (let variant = 0; variant < WATER_VARIANT_COUNT; variant += 1) blit(sheet, paintWaterTile(variant), variant * TILE_PIXELS, 0);
  return sheet;
}

function paintWaterTile(variant) {
  const tile = createCanvas(TILE_PIXELS, TILE_PIXELS);
  const seed = 211 + variant * 13;
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) pixel(tile, x, y, WATER_COLORS.water);
  }
  for (let bandTop = 0; bandTop < TILE_PIXELS; bandTop += BAND_PIXELS) paintRipple(tile, { bandTop, seed });
  return tile;
}

/** One ripple in the band that starts at `bandTop`: light or dark by turns down the tile, clear of the tile's edge, a light one sometimes with a glint on it. */
function paintRipple(tile, { bandTop, seed }) {
  const length = SHORTEST_RIPPLE + Math.floor(noise(bandTop, 1, seed) * (LONGEST_RIPPLE - SHORTEST_RIPPLE + 1));
  const left = 1 + Math.floor(noise(bandTop, 2, seed) * (TILE_PIXELS - 2 - length + 1));
  // Rows 1 and 2 of the band: never the tile's first row, never its last.
  const y = bandTop + 1 + Math.floor(noise(bandTop, 3, seed) * 2);
  const isLight = (bandTop / BAND_PIXELS + seed) % 2 === 0;
  for (let x = left; x < left + length; x += 1) pixel(tile, x, y, isLight ? WATER_COLORS.rippleLight : WATER_COLORS.rippleShade);
  if (isLight && noise(bandTop, 4, seed) < 0.5) pixel(tile, left + 1, y, WATER_COLORS.glint);
}

/** Writes the water sheet into `directory` as `water.png` and returns the path. */
export function writeWaterSheet(directory) {
  return writeSheet({ directory, key: WATER_SPRITE_KEY, sheet: paintWaterSheet() });
}

writeSheetWhenRunDirectly(import.meta.url, writeWaterSheet);
