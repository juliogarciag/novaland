/**
 * Generates the rock sheet at public/sprites/rock.png: ROCK_VARIANT_COUNT frames
 * side by side, each FRAME_WIDTH x FRAME_HEIGHT. The frame layout must match
 * the rock's `standingSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * A frame is one boulder, or a boulder and a smaller stone, sitting on the
 * bottom-centre of its frame. It stays inside the width of its tile and
 * rises a few pixels above it, so a rock reads as a lump on the ground and
 * not as a floor tile. A boulder is a few overlapping lumps lit from the
 * top-left and shaded in four flat greys with a one-pixel dark edge, like
 * the trees and the avatars, with a crack or two and a little moss at its foot.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-rock-sheet.mjs                # writes public/sprites/rock.png
 *   node tools/generate-rock-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { blit, blitOpaque, createCanvas, noise, outline, pixel } from './pixelCanvas.mjs';
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
  moss: [0x43, 0x8c, 0x45],
  mossShade: [0x2f, 0x6b, 0x3a],
};

/** The shadow a rock casts on the ground around its foot: black at this opacity (0-255). */
const GROUND_SHADOW_ALPHA = 70;

/** The lowest row a stone may reach; the rows below it hold the dark edge and the shadow. */
const FOOT_ROW = FRAME_HEIGHT - 3;

/**
 * One entry per frame. `lumps` are the masses of the rock as ellipses in
 * frame pixels, cut off flat at the foot row; `cracks` are single dark
 * pixels; `moss` are pixels of moss at the foot; `seed` scatters the grain
 * so no two variants share it.
 */
const ROCK_VARIANTS = [
  {
    seed: 5,
    lumps: [
      { x: 7.5, y: 11.5, radiusX: 6, radiusY: 6.5 },
      { x: 10.5, y: 13.5, radiusX: 4, radiusY: 4.5 },
    ],
    cracks: [
      [9, 9],
      [9, 10],
      [10, 11],
    ],
    moss: [
      [3, 16],
      [4, 17],
      [5, 17],
    ],
  },
  {
    seed: 17,
    lumps: [
      { x: 6, y: 11, radiusX: 4.5, radiusY: 6.5 },
      { x: 11.5, y: 14, radiusX: 3, radiusY: 3.5 },
    ],
    cracks: [
      [6, 12],
      [7, 13],
    ],
    moss: [
      [9, 17],
      [10, 17],
    ],
  },
  {
    seed: 29,
    lumps: [
      { x: 8, y: 13, radiusX: 6.5, radiusY: 4.5 },
      { x: 5.5, y: 11.5, radiusX: 3.5, radiusY: 4 },
    ],
    cracks: [
      [10, 12],
      [11, 13],
      [11, 14],
    ],
    moss: [
      [12, 17],
      [13, 16],
    ],
  },
  {
    seed: 41,
    lumps: [
      { x: 9.5, y: 10.5, radiusX: 4.5, radiusY: 7 },
      { x: 5, y: 14, radiusX: 3.5, radiusY: 3.5 },
      { x: 12, y: 14.5, radiusX: 2.5, radiusY: 3 },
    ],
    cracks: [
      [9, 8],
      [10, 9],
      [10, 10],
    ],
    moss: [
      [2, 17],
      [3, 17],
      [7, 17],
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
  paintGroundShadow(frame);
  paintStone(frame, variant);
  return frame;
}

/** A soft dark ellipse on the ground around the rock's foot, reaching a little to the right, away from the light. */
function paintGroundShadow(frame) {
  const centre = { x: FRAME_WIDTH / 2 + 0.5, y: FOOT_ROW + 0.5 };
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const across = (x + 0.5 - centre.x) / 7.5;
      const down = (y + 0.5 - centre.y) / 2.4;
      if (across * across + down * down <= 1) pixel(frame, x, y, [0, 0, 0], GROUND_SHADOW_ALPHA);
    }
  }
}

/**
 * Every pixel inside a lump belongs to the lump that bulges most there and
 * takes its tone from where it sits on that lump: towards the top-left is
 * lit, towards the bottom-right is in shade. Stone is smoother than leaves,
 * so the grain is slight and the tones fall in broad facets. Pixels on the
 * seam under another lump go dark, which separates the lumps.
 */
function paintStone(frame, { lumps, cracks, moss, seed }) {
  const stone = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  for (let y = 0; y <= FOOT_ROW; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const owner = lumpAt(lumps, x, y);
      if (!owner) continue;
      const { lump, bulge } = owner;
      const towardsLight = -((x + 0.5 - lump.x) / lump.radiusX) * 0.6 - ((y + 0.5 - lump.y) / lump.radiusY) * 0.8;
      const grain = (noise(x, y, seed) - 0.5) * 0.2;
      const light = towardsLight + grain + (bulge < 0.2 && towardsLight < 0.15 ? -0.45 : 0);
      pixel(stone, x, y, stoneTone(light));
    }
  }
  for (const [x, y] of cracks) pixel(stone, x, y, COLORS.stoneShade);
  for (const [x, y] of moss) pixel(stone, x, y, noise(x, y, seed) < 0.5 ? COLORS.moss : COLORS.mossShade);
  outline(stone, COLORS.stoneEdge);
  blitOpaque(frame, stone);
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
