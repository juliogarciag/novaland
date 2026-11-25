/**
 * Generates the rock sheet at public/sprites/rock.png: ROCK_VARIANT_COUNT frames
 * side by side, each FRAME_WIDTH x FRAME_HEIGHT. The frame layout must match
 * the rock's `standingSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * A frame is one boulder, or a boulder and a smaller stone, half sunk into
 * the ground at the bottom-centre of its frame: the stone has no lower
 * edge, it ends in the grass that grows up around its foot. It stays inside
 * the width of its tile. A boulder is a few overlapping lumps lit from the
 * top-left and shaded in four flat greys with a one-pixel dark edge above
 * the ground, like the trees and the avatars, with a crack or two.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-rock-sheet.mjs                # writes public/sprites/rock.png
 *   node tools/generate-rock-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { GRASS_COLORS } from './generate-grass-sheet.mjs';
import { blit, blitOpaque, createCanvas, isOpaque, noise, outline, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const ROCK_SPRITE_KEY = 'rock';
export const FRAME_WIDTH = 16;
export const FRAME_HEIGHT = 20;

const COLORS = {
  stoneEdge: [0x2b, 0x2d, 0x36],
  stoneShade: [0x55, 0x5a, 0x66],
  stone: [0x8a, 0x8f, 0x99],
  stoneLight: [0xa9, 0xae, 0xb8],
  stoneHighlight: [0xcb, 0xcf, 0xd6],
};

/** The row where the stone goes into the ground: it is cut off flat here and the grass covers the cut. */
const GROUND_ROW = FRAME_HEIGHT - 3;

/** Of every ten columns of the stone's foot, how many have a blade of grass standing a pixel taller than the lawn in front of it. */
const TALLER_BLADES_IN_TEN_COLUMNS = 4;

/**
 * One entry per frame. `lumps` are the masses of the rock as ellipses in
 * frame pixels, cut off flat at the ground row, so their centres sit low:
 * the widest part of a lump is at or below the ground; `cracks` are single
 * dark pixels; `seed` scatters the grain so no two variants share it.
 */
const ROCK_VARIANTS = [
  {
    seed: 5,
    lumps: [
      { x: 8, y: 15, radiusX: 6, radiusY: 8 },
      { x: 11.5, y: 16.5, radiusX: 3.5, radiusY: 5 },
    ],
    cracks: [
      [9, 10],
      [9, 11],
      [10, 12],
    ],
  },
  {
    seed: 17,
    lumps: [
      { x: 6.5, y: 15.5, radiusX: 4.5, radiusY: 8 },
      { x: 12.5, y: 17, radiusX: 2.5, radiusY: 4 },
    ],
    cracks: [
      [6, 11],
      [7, 12],
    ],
  },
  {
    seed: 29,
    lumps: [
      { x: 8.5, y: 16.5, radiusX: 6.5, radiusY: 5.5 },
      { x: 5.5, y: 16, radiusX: 3.5, radiusY: 6.5 },
    ],
    cracks: [
      [10, 13],
      [11, 14],
    ],
  },
  {
    seed: 41,
    lumps: [
      { x: 9.5, y: 15, radiusX: 4.5, radiusY: 9.5 },
      { x: 4.5, y: 17, radiusX: 3, radiusY: 5 },
    ],
    cracks: [
      [9, 9],
      [10, 10],
      [10, 11],
    ],
  },
];

export const ROCK_VARIANT_COUNT = ROCK_VARIANTS.length;

/** The whole sheet: every variant side by side. */
export function paintRockSheet() {
  const sheet = createCanvas(FRAME_WIDTH * ROCK_VARIANT_COUNT, FRAME_HEIGHT);
  ROCK_VARIANTS.forEach((variant, index) => blit(sheet, paintRock(variant), index * FRAME_WIDTH, 0));
  return sheet;
}

function paintRock(variant) {
  const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintStone(frame, variant);
  return frame;
}

/**
 * Every pixel inside a lump belongs to the lump that bulges most there and
 * takes its tone from where it sits on that lump: towards the top-left is
 * lit, towards the bottom-right is in shade. Stone is smoother than leaves,
 * so the grain is slight and the tones fall in broad facets. Pixels on the
 * seam under another lump go dark, which separates the lumps.
 */
function paintStone(frame, { lumps, cracks, seed }) {
  const stone = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  for (let y = 0; y <= GROUND_ROW; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const owner = lumpAt(lumps, x, y);
      if (!owner) continue;
      const { lump, bulge } = owner;
      const towardsLight = -((x + 0.5 - lump.x) / lump.radiusX) * 0.4 - ((y + 0.5 - lump.y) / lump.radiusY) * 0.75 - 0.15;
      const grain = (noise(x, y, seed) - 0.5) * 0.2;
      const light = towardsLight + grain + (bulge < 0.2 && towardsLight < 0.15 ? -0.45 : 0);
      pixel(stone, x, y, stoneTone(light));
    }
  }
  for (const [x, y] of cracks) pixel(stone, x, y, COLORS.stoneShade);
  outline(stone, COLORS.stoneEdge);
  buryFoot(stone, seed);
  blitOpaque(frame, stone);
}

/**
 * Sinks the stone into the ground: the dark edge under it is taken away
 * and its lowest row is covered by the lawn in front of it, with a blade
 * of grass standing a pixel taller in some columns. The rock ends in a
 * ragged line of grass instead of sitting on top of the lawn, and it casts
 * no shadow: what is in the ground does not stand over it.
 */
function buryFoot(stone, seed) {
  for (let x = 0; x < FRAME_WIDTH; x += 1) {
    if (!isOpaque(stone, x, GROUND_ROW)) continue;
    pixel(stone, x, GROUND_ROW + 1, [0, 0, 0], 0);
    pixel(stone, x, GROUND_ROW, GRASS_COLORS.turf);
    if (noise(x, GROUND_ROW, seed) * 10 < TALLER_BLADES_IN_TEN_COLUMNS) pixel(stone, x, GROUND_ROW - 1, noise(x, GROUND_ROW, seed + 1) < 0.5 ? GRASS_COLORS.bladeLight : GRASS_COLORS.turfShade);
  }
}

/** The lump covering this pixel that bulges most there, or undefined outside the rock. `bulge` is 1 at its centre, 0 at its rim. */
function lumpAt(lumps, x, y) {
  let best;
  for (const lump of lumps) {
    const distance = Math.hypot((x + 0.5 - lump.x) / lump.radiusX, (y + 0.5 - lump.y) / lump.radiusY);
    const bulge = 1 - distance;
    if (bulge >= 0 && (!best || bulge > best.bulge)) best = { lump, bulge };
  }
  return best;
}

function stoneTone(light) {
  if (light > 0.6) return COLORS.stoneHighlight;
  if (light > 0.18) return COLORS.stoneLight;
  if (light > -0.4) return COLORS.stone;
  return COLORS.stoneShade;
}

/** Writes the rock sheet into `directory` as `rock.png` and returns the path. */
export function writeRockSheet(directory) {
  return writeSheet({ directory, key: ROCK_SPRITE_KEY, sheet: paintRockSheet() });
}

writeSheetWhenRunDirectly(import.meta.url, writeRockSheet);
