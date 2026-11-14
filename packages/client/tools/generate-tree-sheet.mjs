/**
 * Generates the tree sheet at public/sprites/tree.png: TREE_VARIANTS frames
 * side by side, each FRAME_WIDTH x FRAME_HEIGHT. The frame layout must match
 * the tree's `standing` def in packages/sim/src/features/terrain/defs.ts.
 *
 * A frame is one tree standing on the bottom-centre of its frame: a trunk in
 * the lowest tile and a canopy that overhangs the tile to the north and a few
 * pixels to each side, so neighbouring trees overlap into a forest. The
 * canopy is a handful of overlapping leaf clumps lit from the top-left and
 * shaded in four flat tones with a one-pixel dark edge, like the avatars.
 *
 * Plain Node, no dependencies; the PNG encoder is the avatar generator's.
 *
 *   node tools/generate-tree-sheet.mjs                # writes public/sprites/tree.png
 *   node tools/generate-tree-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './generate-player-sheet.mjs';

export const TREE_SPRITE_KEY = 'tree';
export const FRAME_WIDTH = 24;
export const FRAME_HEIGHT = 32;

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

/** Row of the frame the trunk stands on; the row below it is the shadow's lower edge. */
const TRUNK_FOOT_ROW = FRAME_HEIGHT - 3;

/**
 * One entry per frame. `clumps` are the leaf clumps of the canopy as circles
 * in frame pixels; `trunkColumn` is the left column of the four-pixel trunk;
 * `seed` scatters the leaf texture so no two variants share it.
 */
const TREE_VARIANTS_SPEC = [
  {
    seed: 11,
    trunkColumn: 10,
    clumps: [
      { x: 11.5, y: 8, radius: 7 },
      { x: 7, y: 13.5, radius: 6 },
      { x: 16.5, y: 13.5, radius: 6 },
      { x: 12, y: 16.5, radius: 6 },
    ],
  },
  {
    seed: 23,
    trunkColumn: 10,
    clumps: [
      { x: 12, y: 6.5, radius: 5.5 },
      { x: 8, y: 10.5, radius: 6 },
      { x: 15.5, y: 11, radius: 6.5 },
      { x: 10, y: 16.5, radius: 6 },
      { x: 15, y: 17, radius: 5 },
    ],
  },
  {
    seed: 37,
    trunkColumn: 10,
    clumps: [
      { x: 10, y: 7.5, radius: 6 },
      { x: 15.5, y: 8.5, radius: 5.5 },
      { x: 6.5, y: 14, radius: 5.5 },
      { x: 17, y: 14.5, radius: 6 },
      { x: 12, y: 15.5, radius: 6.5 },
    ],
  },
];

export const TREE_VARIANTS = TREE_VARIANTS_SPEC.length;

/** The whole sheet: every variant side by side. */
export function paintTreeSheet() {
  const sheet = createCanvas(FRAME_WIDTH * TREE_VARIANTS, FRAME_HEIGHT);
  TREE_VARIANTS_SPEC.forEach((variant, index) => blit(sheet, paintTree(variant), index * FRAME_WIDTH, 0));
  return sheet;
}

function paintTree(variant) {
  const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintGroundShadow(frame);
  paintTrunk(frame, variant.trunkColumn);
  paintCanopy(frame, variant);
  return frame;
}

/** A soft dark ellipse on the ground around the trunk's foot. */
function paintGroundShadow(frame) {
  const centre = { x: FRAME_WIDTH / 2, y: TRUNK_FOOT_ROW + 0.5 };
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const across = (x + 0.5 - centre.x) / 8;
      const down = (y + 0.5 - centre.y) / 2.6;
      if (across * across + down * down <= 1) pixel(frame, x, y, [0, 0, 0], GROUND_SHADOW_ALPHA);
    }
  }
}

/** Four pixels wide with a dark edge on each side, lit from the left, flaring into roots on the last row. */
function paintTrunk(frame, trunkColumn) {
  const top = 16;
  for (let y = top; y <= TRUNK_FOOT_ROW; y += 1) {
    pixel(frame, trunkColumn - 1, y, COLORS.trunkEdge);
    pixel(frame, trunkColumn, y, COLORS.trunkLight);
    pixel(frame, trunkColumn + 1, y, COLORS.trunk);
    pixel(frame, trunkColumn + 2, y, COLORS.trunk);
    pixel(frame, trunkColumn + 3, y, COLORS.trunkShade);
    pixel(frame, trunkColumn + 4, y, COLORS.trunkEdge);
  }
  // Roots: the foot is two pixels wider than the trunk, with the edge wrapped around it.
  pixel(frame, trunkColumn - 1, TRUNK_FOOT_ROW, COLORS.trunk);
  pixel(frame, trunkColumn + 4, TRUNK_FOOT_ROW, COLORS.trunkShade);
  pixel(frame, trunkColumn - 2, TRUNK_FOOT_ROW, COLORS.trunkEdge);
  pixel(frame, trunkColumn + 5, TRUNK_FOOT_ROW, COLORS.trunkEdge);
  for (let x = trunkColumn - 1; x <= trunkColumn + 4; x += 1) pixel(frame, x, TRUNK_FOOT_ROW + 1, COLORS.trunkEdge);
  // A knot, so the trunk is not a plain bar.
  pixel(frame, trunkColumn + 2, TRUNK_FOOT_ROW - 3, COLORS.trunkShade);
}

/**
 * Every pixel inside a clump belongs to the clump that bulges most there
 * (the one whose centre it is relatively closest to) and takes its tone from
 * where it sits on that clump: towards the top-left is lit, towards the
 * bottom-right is in shade. A scattered half-step of noise breaks the bands
 * into leaves. Pixels on the seam under another clump go dark, which is what
 * separates the clumps from each other.
 */
function paintCanopy(frame, { clumps, seed }) {
  const leaf = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const owner = clumpAt(clumps, x, y);
      if (!owner) continue;
      const { clump, bulge } = owner;
      const towardsLight = (-(x + 0.5 - clump.x) * 0.55 - (y + 0.5 - clump.y) * 0.85) / clump.radius;
      const scatter = (noise(x, y, seed) - 0.5) * 0.45;
      const light = towardsLight + scatter + (bulge < 0.22 && towardsLight < 0.2 ? -0.5 : 0);
      pixel(leaf, x, y, canopyTone(light));
    }
  }
  outline(leaf, COLORS.canopyEdge);
  blitOpaque(frame, leaf);
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

/** A repeatable value in [0, 1) for a pixel: an integer hash, so the sheet is the same on every run. */
function noise(x, y, seed) {
  let hash = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

// ---- Pixel canvas ----

function createCanvas(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function pixel(canvas, x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error(`pixel (${x}, ${y}) is outside the ${canvas.width}x${canvas.height} frame`);
  canvas.data.set([r, g, b, alpha], (y * canvas.width + x) * 4);
}

function isOpaque(canvas, x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  return canvas.data[(y * canvas.width + x) * 4 + 3] === 255;
}

/** Paints every transparent pixel that touches the figure, giving it a one-pixel dark edge. */
function outline(canvas, color) {
  const edge = [];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (isOpaque(canvas, x, y)) continue;
      if (isOpaque(canvas, x - 1, y) || isOpaque(canvas, x + 1, y) || isOpaque(canvas, x, y - 1) || isOpaque(canvas, x, y + 1)) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) pixel(canvas, x, y, color);
}

function blit(target, source, atX, atY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceRow = y * source.width * 4;
    const targetRow = ((atY + y) * target.width + atX) * 4;
    target.data.set(source.data.subarray(sourceRow, sourceRow + source.width * 4), targetRow);
  }
}

/** Copies the opaque pixels of `source` over `target`, both the same size. */
function blitOpaque(target, source) {
  for (let offset = 0; offset < source.data.length; offset += 4) {
    if (source.data[offset + 3] === 255) target.data.set(source.data.subarray(offset, offset + 4), offset);
  }
}

// ---- Entry point ----

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(here, '../public/sprites');

/** Writes the tree sheet into `directory` as `tree.png` and returns the path. */
export function writeTreeSheet(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${TREE_SPRITE_KEY}.png`);
  writeFileSync(file, encodePng(paintTreeSheet()));
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the sheet goes to public/sprites');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  console.log(`wrote ${writeTreeSheet(directory)}`);
}
