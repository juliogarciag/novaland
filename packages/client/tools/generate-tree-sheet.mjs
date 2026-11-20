/**
 * Generates the tree sheet at public/sprites/tree.png: TREE_VARIANT_COUNT frames
 * side by side, each FRAME_WIDTH x FRAME_HEIGHT. The frame layout must match
 * the tree's `standingSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * A frame is one tree standing on the bottom-centre of its frame: a trunk in
 * the lowest tile and a canopy that overhangs the tile to the north and a few
 * pixels to each side, so neighbouring trees overlap into a forest. The
 * canopy is a handful of overlapping leaf clumps lit from the top-left and
 * shaded in four flat tones with a one-pixel dark edge, like the avatars.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-tree-sheet.mjs                # writes public/sprites/tree.png
 *   node tools/generate-tree-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { blit, blitOpaque, createCanvas, noise, outline, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const TREE_SPRITE_KEY = 'tree';
export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 64;

const COLORS = {
  canopyEdge: [0x14, 0x2e, 0x1f],
  canopyShade: [0x1f, 0x4d, 0x2e],
  canopy: [0x2f, 0x6b, 0x3a],
  canopyLight: [0x43, 0x8c, 0x45],
  canopyHighlight: [0x6a, 0xb0, 0x55],
  trunkEdge: [0x2a, 0x1b, 0x12],
  trunkShade: [0x4f, 0x34, 0x20],
  trunk: [0x6f, 0x4a, 0x2b],
  trunkLight: [0x8a, 0x60, 0x3a],
};

/** The shadow a tree casts on the ground around its foot: black at this opacity (0-255). */
const GROUND_SHADOW_ALPHA = 70;

/** Row of the frame the trunk stands on; the shadow reaches a few rows below it. */
const TRUNK_FOOT_ROW = FRAME_HEIGHT - 6;

/** How wide the trunk is between its dark edges, in pixels. */
const TRUNK_PIXELS = 8;

/**
 * One entry per frame. `clumps` are the leaf clumps of the canopy as circles
 * in frame pixels: a crown on top and a wide, flat skirt of clumps at the
 * bottom that hangs out past the crown on both sides, so the canopy is a
 * broad dome over the trunk rather than a ball narrowing into it.
 * `trunkColumn` is the left column of the trunk; `seed` scatters the leaf
 * texture and the tufts round the rim so no two variants share them.
 */
const TREE_VARIANTS = [
  {
    seed: 11,
    trunkColumn: 20,
    clumps: [
      { x: 24, y: 14, radius: 11 },
      { x: 15, y: 22, radius: 10 },
      { x: 33, y: 22, radius: 10 },
      { x: 10, y: 33, radius: 8.5 },
      { x: 38, y: 33, radius: 8.5 },
      { x: 24, y: 30, radius: 12 },
    ],
  },
  {
    seed: 23,
    trunkColumn: 20,
    clumps: [
      { x: 21, y: 12, radius: 9.5 },
      { x: 30, y: 16, radius: 10 },
      { x: 14, y: 24, radius: 10 },
      { x: 9, y: 34, radius: 7.5 },
      { x: 37, y: 31, radius: 9.5 },
      { x: 23, y: 31, radius: 12 },
    ],
  },
  {
    seed: 37,
    trunkColumn: 20,
    clumps: [
      { x: 25, y: 11, radius: 9 },
      { x: 17, y: 19, radius: 10.5 },
      { x: 33, y: 21, radius: 10 },
      { x: 11, y: 31, radius: 9 },
      { x: 39, y: 34, radius: 7.5 },
      { x: 25, y: 31, radius: 11.5 },
    ],
  },
];

/** Small clumps set round the rim of every canopy, so its outline is a run of leafy bumps instead of a few smooth arcs. */
const RIM_TUFTS = 22;
const RIM_TUFT_RADIUS = { smallest: 3, largest: 4.5 };

/** How far up from the canopy's lowest row its underside is in shade, in pixels. */
const UNDERSIDE_PIXELS = 10;

export const TREE_VARIANT_COUNT = TREE_VARIANTS.length;

/** The whole sheet: every variant side by side. */
export function paintTreeSheet() {
  const sheet = createCanvas(FRAME_WIDTH * TREE_VARIANT_COUNT, FRAME_HEIGHT);
  TREE_VARIANTS.forEach((variant, index) => blit(sheet, paintTree(variant), index * FRAME_WIDTH, 0));
  return sheet;
}

function paintTree(variant) {
  const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintGroundShadow(frame);
  paintTrunk(frame, variant);
  shadeTrunkUnderCanopy(frame, variant);
  paintCanopy(frame, variant);
  return frame;
}

/** The canopy's shadow on the trunk: the few rows of bark just under the leaves are in shade, darkest at the top. */
function shadeTrunkUnderCanopy(frame, { clumps, trunkColumn }) {
  const firstRow = Math.floor(canopyBottom(clumps));
  for (let step = 0; step < 4; step += 1) {
    for (let x = trunkColumn; x < trunkColumn + TRUNK_PIXELS; x += 1) {
      if (step < 2 || x >= trunkColumn + 2) pixel(frame, x, firstRow + step, step === 0 ? COLORS.trunkEdge : COLORS.trunkShade);
    }
  }
}

/** A soft dark ellipse on the ground around the trunk's foot. */
function paintGroundShadow(frame) {
  const centre = { x: FRAME_WIDTH / 2, y: TRUNK_FOOT_ROW + 1 };
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const across = (x + 0.5 - centre.x) / 16;
      const down = (y + 0.5 - centre.y) / 5.2;
      if (across * across + down * down <= 1) pixel(frame, x, y, [0, 0, 0], GROUND_SHADOW_ALPHA);
    }
  }
}

/**
 * TRUNK_PIXELS wide with a dark edge on each side, lit from the left, with
 * a few streaks of bark and a knot, flaring into roots over its last rows.
 */
function paintTrunk(frame, { trunkColumn, seed }) {
  const top = 32;
  const right = trunkColumn + TRUNK_PIXELS - 1;
  for (let y = top; y <= TRUNK_FOOT_ROW; y += 1) {
    pixel(frame, trunkColumn - 1, y, COLORS.trunkEdge);
    for (let x = trunkColumn; x <= right; x += 1) pixel(frame, x, y, trunkTone(x - trunkColumn));
    pixel(frame, right + 1, y, COLORS.trunkEdge);
  }
  // Bark: short streaks of the shade down the lit part of the trunk.
  for (let x = trunkColumn + 2; x <= right - 2; x += 2) {
    const streakTop = top + 2 + Math.floor(noise(x, top, seed) * 14);
    const streakLength = 3 + Math.floor(noise(x, top, seed + 1) * 4);
    for (let y = streakTop; y < streakTop + streakLength && y < TRUNK_FOOT_ROW - 2; y += 1) pixel(frame, x, y, COLORS.trunkShade);
  }
  // A knot, so the trunk is not a plain bar.
  for (const [x, y] of [[trunkColumn + 4, TRUNK_FOOT_ROW - 8], [trunkColumn + 5, TRUNK_FOOT_ROW - 8], [trunkColumn + 4, TRUNK_FOOT_ROW - 7]]) pixel(frame, x, y, COLORS.trunkEdge);
  // Roots: the trunk widens by a pixel on each side over its last two rows and by two on the last, with the edge wrapped around it.
  for (const [rows, spread] of [[[TRUNK_FOOT_ROW - 2, TRUNK_FOOT_ROW - 1], 1], [[TRUNK_FOOT_ROW], 2]]) {
    for (const y of rows) {
      for (let step = 1; step <= spread; step += 1) {
        pixel(frame, trunkColumn - step, y, COLORS.trunk);
        pixel(frame, right + step, y, COLORS.trunkShade);
      }
      pixel(frame, trunkColumn - spread - 1, y, COLORS.trunkEdge);
      pixel(frame, right + spread + 1, y, COLORS.trunkEdge);
    }
  }
  for (let x = trunkColumn - 2; x <= right + 2; x += 1) pixel(frame, x, TRUNK_FOOT_ROW + 1, COLORS.trunkEdge);
}

/** The tone of a column of the trunk, counted from its left edge: lit on the left, in shade on the right. */
function trunkTone(column) {
  if (column < 2) return COLORS.trunkLight;
  if (column < TRUNK_PIXELS - 2) return COLORS.trunk;
  return COLORS.trunkShade;
}

/**
 * Every pixel inside a clump belongs to the clump that bulges most there
 * (the one whose centre it is relatively closest to) and takes its tone from
 * where it sits on that clump: towards the top-left is lit, towards the
 * bottom-right is in shade. The whole canopy is lit from above too, so its
 * underside darkens towards the trunk. A scattered half-step of noise breaks
 * the bands into leaves. Pixels on the seam under another clump go dark,
 * which is what separates the clumps from each other.
 */
function paintCanopy(frame, { clumps: mainClumps, seed }) {
  const clumps = [...mainClumps, ...rimTufts(mainClumps, seed)];
  const bottom = canopyBottom(mainClumps);
  const leaf = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const owner = clumpAt(clumps, x, y);
      if (!owner) continue;
      const { clump, bulge } = owner;
      const towardsLight = (-(x + 0.5 - clump.x) * 0.55 - (y + 0.5 - clump.y) * 0.85) / clump.radius;
      const underside = Math.min(1, Math.max(0, (y - (bottom - UNDERSIDE_PIXELS)) / UNDERSIDE_PIXELS)) * 0.7;
      // Leaves are two pixels across, with a little grain of their own: noise on single pixels would read as sand.
      const scatter = (noise(Math.floor(x / 2), Math.floor(y / 2), seed) - 0.5) * 0.4 + (noise(x, y, seed + 1) - 0.5) * 0.15;
      const light = towardsLight - underside + scatter + (bulge < 0.22 && towardsLight < 0.2 ? -0.5 : 0);
      pixel(leaf, x, y, canopyTone(light));
    }
  }
  outline(leaf, COLORS.canopyEdge);
  blitOpaque(frame, leaf);
}

/** The lowest row any of these clumps reaches. */
function canopyBottom(clumps) {
  return Math.max(...clumps.map((clump) => clump.y + clump.radius));
}

/**
 * Small clumps round the rim: walking round the canopy's middle, one every
 * so many degrees, each set where the canopy ends in that direction and a
 * little inside it, so half of it bulges out. None hangs below the canopy's
 * lowest row (the trunk stays clear) or leaves the frame.
 */
function rimTufts(clumps, seed) {
  const centre = { x: FRAME_WIDTH / 2, y: clumps.reduce((sum, clump) => sum + clump.y, 0) / clumps.length };
  const bottom = canopyBottom(clumps);
  const tufts = [];
  for (let index = 0; index < RIM_TUFTS; index += 1) {
    const angle = ((index + noise(index, 0, seed + 3) * 0.6) / RIM_TUFTS) * Math.PI * 2;
    let reach = 0;
    while (clumpAt(clumps, centre.x + Math.cos(angle) * (reach + 1), centre.y + Math.sin(angle) * (reach + 1))) reach += 1;
    const radius = RIM_TUFT_RADIUS.smallest + noise(index, 1, seed + 3) * (RIM_TUFT_RADIUS.largest - RIM_TUFT_RADIUS.smallest);
    const tuft = { x: centre.x + Math.cos(angle) * (reach - radius * 0.4), y: centre.y + Math.sin(angle) * (reach - radius * 0.4), radius };
    const inFrame = tuft.x - tuft.radius >= 1 && tuft.x + tuft.radius <= FRAME_WIDTH - 1 && tuft.y - tuft.radius >= 1;
    if (inFrame && tuft.y + tuft.radius <= bottom) tufts.push(tuft);
  }
  return tufts;
}

/** The clump covering this pixel that bulges most there, or undefined outside the canopy. `bulge` is 1 at its centre, 0 at its rim. */
function clumpAt(clumps, x, y) {
  let best;
  for (const clump of clumps) {
    const distance = Math.hypot(x + 0.5 - clump.x, y + 0.5 - clump.y);
    const bulge = 1 - distance / clump.radius;
    if (bulge >= 0 && (!best || bulge > best.bulge)) best = { clump, bulge };
  }
  return best;
}

function canopyTone(light) {
  if (light > 0.62) return COLORS.canopyHighlight;
  if (light > 0.22) return COLORS.canopyLight;
  if (light > -0.38) return COLORS.canopy;
  return COLORS.canopyShade;
}

/** Writes the tree sheet into `directory` as `tree.png` and returns the path. */
export function writeTreeSheet(directory) {
  return writeSheet({ directory, key: TREE_SPRITE_KEY, sheet: paintTreeSheet() });
}

writeSheetWhenRunDirectly(import.meta.url, writeTreeSheet);
