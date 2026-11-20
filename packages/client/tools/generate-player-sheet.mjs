/**
 * Generates the character sheet at public/sprites/player.png, the sprite of
 * the player def in packages/sim/src/features/player/defs.ts.
 *
 * The sheet is painted in the template colours of TEMPLATE_PALETTE: the
 * client swaps each of them for a colour it derives from the skin, hair and
 * clothes colours a player picked (src/render/characterSheet.ts, whose
 * TEMPLATE_COLORS must match; the generator's test checks it), so those must
 * not be used for anything else in the figure.
 *
 * Four rows (down, up, left, right) of four 32x48 frames. Frame 0 of each row
 * is the idle pose; the walk cycle plays the whole row: stand, left step,
 * passing pose (body two pixels taller), right step. The frame layout must
 * match the def's `sprite`.
 *
 * Each frame is painted in two layers: the body (legs, torso, arms, the face
 * with its eyebrows) and the hair above it. The skull under the hair is
 * painted whole in skin, so any hairstyle (HAIRSTYLES) can go over it; the
 * outline goes around both layers together. The eyebrows stay on the body,
 * in the hair's shade.
 *
 * Every part is drawn as a stencil, one character per pixel (see
 * STENCIL_KEYS), so the art reads as it looks. Light comes from the left: every material is
 * darker on its right edge and the hair and the shirt carry a highlight.
 *
 * Plain Node, no dependencies: the figure is painted into an RGBA buffer and
 * written as a PNG by the small encoder at the bottom.
 *
 *   node tools/generate-player-sheet.mjs                # writes the sheet into public/sprites/
 *   node tools/generate-player-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { blit, blitOpaque, createCanvas, outline, pixel } from './pixelCanvas.mjs';

export const FRAME_WIDTH = 32;
export const FRAME_HEIGHT = 48;
export const DIRECTIONS = ['down', 'up', 'left', 'right'];
export const FRAMES_PER_DIRECTION = 4;

/** Sprite key of the player def: the sheet is written as `<key>.png`. */
export const PLAYER_SHEET_KEY = 'player';

/** Colours the client never swaps. */
export const FIXED_PALETTE = {
  outline: [0x1f, 0x1a, 0x17],
  eye: [0x14, 0x12, 0x1a],
  eyeShine: [0xff, 0xff, 0xff],
  shoe: [0x1f, 0x29, 0x37],
  shoeLight: [0x2f, 0x3b, 0x4c],
  pants: [0x37, 0x41, 0x51],
  pantsShade: [0x26, 0x2d, 0x3a],
};

/**
 * Colours the client swaps for a player's look. Each part has one colour a
 * player picks (`skin`, `hair`, `clothes`); the others are its shade and
 * highlight, which the client derives from the picked colour. The template's
 * own shades are derived from its base colours the same way.
 */
export const TEMPLATE_PALETTE = {
  skin: [0xf1, 0xc2, 0x7d],
  skinShade: [0xb5, 0x92, 0x5e],
  hair: [0x6b, 0x3e, 0x1e],
  hairShade: [0x50, 0x2f, 0x17],
  hairLight: [0x9a, 0x64, 0x3e],
  clothes: [0x3b, 0x82, 0xf6],
  clothesShade: [0x2c, 0x62, 0xb9],
  clothesLight: [0x60, 0xb6, 0xff],
};

/** The colour each stencil character paints; `.` leaves the pixel as it is. */
const STENCIL_KEYS = {
  s: 'skin',
  S: 'skinShade',
  b: 'hairShade', // eyebrows
  e: 'eye',
  w: 'eyeShine',
  h: 'hair',
  H: 'hairShade',
  l: 'hairLight',
  c: 'clothes',
  C: 'clothesShade',
  L: 'clothesLight',
  p: 'pants',
  P: 'pantsShade',
  o: 'shoe',
  q: 'shoeLight',
};

/** How the body is posed in each of the four frames of a row. `forwardLeg` is from the character's point of view. */
const POSES = [
  { bob: 0, forwardLeg: null },
  { bob: 0, forwardLeg: 'left' },
  { bob: -2, forwardLeg: null },
  { bob: 0, forwardLeg: 'right' },
];

/** The whole sheet as RGBA bytes, rows top to bottom. */
export function paintPlayerSheet() {
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      const { body, hair } = paintFrameLayers(direction, pose);
      const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
      blitOpaque(frame, body);
      blitOpaque(frame, hair);
      outline(frame, FIXED_PALETTE.outline);
      blit(sheet, frame, column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/** Last row of the figure. Its outline takes the row below; the last row stays clear. */
const FEET_ROW = 45;
/** First column of the head stencils, which are 22 wide: the 20-pixel skull plus a column each side for a nose in profile. */
const HEAD_LEFT = 5;

/**
 * One frame's two layers, unoutlined, each the size of a frame: the body,
 * and the hair of `hairstyle` (a key of HAIRSTYLES) that goes over it.
 */
function paintFrameLayers(direction, pose, hairstyle = PLAYER_HAIRSTYLE) {
  const colors = { ...FIXED_PALETTE, ...TEMPLATE_PALETTE };
  // First row of the head. The passing pose lifts it by two; the rows above it still hold the outline and a clear row.
  const top = 4 + pose.bob;
  const torsoTop = top + FACE_STENCILS[direction].length + 1; // the neck sits on the row between head and torso
  const body = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintLegs(body, colors, { direction, pose, top: torsoTop + TORSO.length });
  paintTorsoAndArms(body, colors, { direction, pose, top: torsoTop });
  paintStencil(body, colors, { rows: FACE_STENCILS[direction], left: HEAD_LEFT, top });
  const hair = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintStencil(hair, colors, { rows: HAIRSTYLES[hairstyle][direction], left: HEAD_LEFT, top });
  return { body, hair };
}

/**
 * The face, 22 columns from HEAD_LEFT by 18 rows: a 20-wide skull with
 * stepped corners, wider than the torso, a column clear on each side but
 * where a profile's nose sticks out, painted whole in skin with everything on it (eyebrows, eyes
 * with a shine, nose shade, mouth). A hairstyle goes over it.
 */
const FACE_STENCILS = {
  down: [
    '.....sssssssssssS.....',
    '...sssssssssssssssS...',
    '..sssssssssssssssssS..',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssbbbssssbbbssssS.',
    '.sssssssssssssssssssS.',
    '.sssssweessssweessssS.',
    '.ssssseeesssseeessssS.',
    '.ssssseeesssseeessssS.',
    '.ssssssssssSssssssssS.',
    '.sssssssssssssssssssS.',
    '..ssssssssSSsssssssS..',
    '...sssssssssssssssS...',
    '.....sssssssssssS.....',
  ],
  up: [
    '.....sssssssssssS.....',
    '...sssssssssssssssS...',
    '..sssssssssssssssssS..',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '..sssssssssssssssssS..',
    '...sssssssssssssssS...',
    '.....sssssssssssS.....',
  ],
  left: [
    '.....sssssssssssS.....',
    '...sssssssssssssssS...',
    '..sssssssssssssssssS..',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.ssbbbssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sswesssssssssssssssS.',
    '.sseesssssssssssssssS.',
    '.sseesssssssssssssssS.',
    'ssssssssssssssssssssS.',
    '.SssssssssssssssssssS.',
    '..ssSSsssssssssssssS..',
    '...sssssssssssssssS...',
    '.....sssssssssssS.....',
  ],
  right: [
    '.....sssssssssssS.....',
    '...sssssssssssssssS...',
    '..sssssssssssssssssS..',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssbbbsS.',
    '.sssssssssssssssssssS.',
    '.sssssssssssssssswesS.',
    '.sssssssssssssssseesS.',
    '.sssssssssssssssseesS.',
    '.sssssssssssssssssssSS',
    '.sssssssssssssssssssS.',
    '..ssssssssssssssSSsS..',
    '...sssssssssssssssS...',
    '.....sssssssssssS.....',
  ],
};

/**
 * Hairstyles: for each direction, rows in the frame of FACE_STENCILS painted
 * on the hair layer. A new hairstyle is a new entry; the sheet wears
 * `PLAYER_HAIRSTYLE`. Hair may stand past the skull (the outline goes around
 * it), within the frame's clear margin.
 */
const HAIRSTYLES = {
  short: {
    down: [
      '.....llllllhhhhhH.....',
      '...hllllllhhhhhhhhH...',
      '..hhhhhhhhhhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhh.hh.hh.hh.hh.hhhH.',
      '.hh................hH.',
      '.hh................hH.',
      '.h..................H.',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
    ],
    up: [
      '.....llllllhhhhhH.....',
      '...hllllllhhhhhhhhH...',
      '..hhhhhhhhhhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '..hhhhhhhhhhhhhhhhhH..',
      '...hhhhhhhhhhhhhhhH...',
      '.....hh.hhh.hhhhH.....',
    ],
    left: [
      '.....llllllhhhhhH.....',
      '...hllllllhhhhhhhhH...',
      '..hhhhhhhhhhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.h.hh.hhhhhhhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhhH.',
      '...........hhhhhhhhH..',
      '...........hhhhhhhH...',
      '...........hhhhhH.....',
    ],
    right: [
      '.....llllllhhhhhH.....',
      '...hllllllhhhhhhhhH...',
      '..hhhhhhhhhhhhhhhhhH..',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhhhhhhH.',
      '.hhhhhhhhhhhhhhh.hh.H.',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '.hhhhhhhhhH...........',
      '..hhhhhhhhH...........',
      '...hhhhhhhH...........',
      '.....hhhhhH...........',
    ],
  },
};
const PLAYER_HAIRSTYLE = 'short';

/** The neck, centred under the head on the row above the torso. */
const NECK = ['sssS'];
const NECK_LEFT = 14;

/** The torso, 12 wide from TORSO_LEFT: a highlight down the left, a shade down the right and a darker hem. */
const TORSO = [...Array.from({ length: 10 }, () => 'LccccccccccC'), 'CCCCCCCCCCCC'];
const TORSO_LEFT = 10;
const TORSO_WIDTH = 12;
const ARM_WIDTH = 2;
/** Arms hang beside the torso in front and back views; in profile the near arm hangs over its middle. */
const ARM_COLUMNS = { screenLeft: TORSO_LEFT - ARM_WIDTH, screenRight: TORSO_LEFT + TORSO_WIDTH, profile: TORSO_LEFT + TORSO_WIDTH / 2 - ARM_WIDTH / 2 };

/** An arm, 2 wide: a short sleeve over the skin of the forearm and hand. In profile the sleeve is in shade, so it reads over the torso. */
const ARM = ['cC', 'cC', 'cC', 'cC', 'sS', 'sS', 'sS', 'sS', 'sS', 'sS'];
const ARM_IN_PROFILE = ['CC', 'CC', 'CC', 'CC', 'sS', 'sS', 'sS', 'sS', 'sS', 'sS'];

function paintTorsoAndArms(canvas, colors, { direction, pose, top }) {
  paintStencil(canvas, colors, { rows: NECK, left: NECK_LEFT, top: top - 1 });
  paintStencil(canvas, colors, { rows: TORSO, left: TORSO_LEFT, top });
  const swing = 2 * (pose.forwardLeg === 'left' ? 1 : pose.forwardLeg === 'right' ? -1 : 0);
  if (direction === 'down' || direction === 'up') {
    // The arm opposite the forward leg swings forward (drawn lower), the other one back (higher).
    // Facing the viewer, the character's left arm is on the screen's right.
    const [leftArm, rightArm] = direction === 'down' ? [ARM_COLUMNS.screenRight, ARM_COLUMNS.screenLeft] : [ARM_COLUMNS.screenLeft, ARM_COLUMNS.screenRight];
    paintStencil(canvas, colors, { rows: ARM, left: leftArm, top: top - swing });
    paintStencil(canvas, colors, { rows: ARM, left: rightArm, top: top + swing });
  } else {
    // In profile only the near arm shows, swinging along the walk.
    const left = ARM_COLUMNS.profile + (direction === 'left' ? -swing : swing);
    paintStencil(canvas, colors, { rows: ARM_IN_PROFILE, left, top });
  }
}

const LEG_WIDTH = 5;
const SHOE_ROWS = 3;
/** The two legs side by side under the middle of the torso in front and back views; in profile, where each stands before the walk spreads them. */
const LEG_COLUMNS = {
  screenLeft: TORSO_LEFT + TORSO_WIDTH / 2 - LEG_WIDTH,
  screenRight: TORSO_LEFT + TORSO_WIDTH / 2,
  profileFar: TORSO_LEFT + TORSO_WIDTH / 2 - 2,
  profileNear: TORSO_LEFT + TORSO_WIDTH / 2 - 4,
};

function paintLegs(canvas, colors, { direction, pose, top }) {
  if (direction === 'down' || direction === 'up') {
    // Front and back view: the leg behind the forward one is lifted two pixels, so it is shorter; the forward leg is planted and keeps its length.
    const [leftColumn, rightColumn] = direction === 'down' ? [LEG_COLUMNS.screenRight, LEG_COLUMNS.screenLeft] : [LEG_COLUMNS.screenLeft, LEG_COLUMNS.screenRight];
    paintLeg(canvas, colors, { left: leftColumn, top, lift: pose.forwardLeg === 'right' ? 2 : 0, isFarLeg: false, toeDirection: 0 });
    paintLeg(canvas, colors, { left: rightColumn, top, lift: pose.forwardLeg === 'left' ? 2 : 0, isFarLeg: false, toeDirection: 0 });
    return;
  }
  // Profile: the legs spread apart along the walk and the shoes point ahead. The far leg is drawn first and darker.
  const ahead = direction === 'left' ? -1 : 1;
  const spread = 2 * (pose.forwardLeg === null ? 0 : pose.forwardLeg === 'left' ? ahead : -ahead);
  paintLeg(canvas, colors, { left: LEG_COLUMNS.profileFar - spread, top, lift: 0, isFarLeg: true, toeDirection: ahead });
  paintLeg(canvas, colors, { left: LEG_COLUMNS.profileNear + spread, top, lift: 0, isFarLeg: false, toeDirection: ahead });
}

/**
 * A leg from `top` down to the feet row, `lift` pixels off the ground: pants
 * (shaded on the right; all shade for the far leg in profile), then a shoe
 * with a lighter top. `toeDirection` (-1 west, 1 east, 0 none) is where the
 * shoe's sole reaches one pixel past the leg, in profile.
 */
function paintLeg(canvas, colors, { left, top, lift, isFarLeg, toeDirection }) {
  const bottom = FEET_ROW - lift;
  const pantsRow = isFarLeg ? 'P'.repeat(LEG_WIDTH) : `${'p'.repeat(LEG_WIDTH - 1)}P`;
  const pants = Array.from({ length: bottom - SHOE_ROWS + 1 - top }, () => pantsRow);
  const shoe = [`${'q'.repeat(LEG_WIDTH - 1)}o`, ...Array.from({ length: SHOE_ROWS - 1 }, () => 'o'.repeat(LEG_WIDTH))];
  paintStencil(canvas, colors, { rows: [...pants, ...shoe], left, top });
  if (toeDirection === 0) return;
  const toeColumn = toeDirection < 0 ? left - 1 : left + LEG_WIDTH;
  for (let row = bottom - (SHOE_ROWS - 2); row <= bottom; row += 1) pixel(canvas, toeColumn, row, colors.shoe);
}

/** Paints `rows` of STENCIL_KEYS characters with the top-left one at (left, top). */
function paintStencil(canvas, colors, { rows, left, top }) {
  rows.forEach((row, rowIndex) => {
    [...row].forEach((character, columnIndex) => {
      if (character === '.') return;
      const color = colors[STENCIL_KEYS[character]];
      if (!color) throw new Error(`stencil character '${character}' has no colour`);
      pixel(canvas, left + columnIndex, top + rowIndex, color);
    });
  });
}

export const __testing__ = { HAIRSTYLES, paintFrameLayers, POSES };

// ---- PNG encoder (8-bit RGBA, no filtering, one IDAT) ----

export function encodePng(canvas) {
  const stride = canvas.width * 4;
  const filtered = new Uint8Array((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    filtered[y * (stride + 1)] = 0; // filter type: none
    filtered.set(canvas.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, canvas.width);
  view.setUint32(4, canvas.height);
  header.set([8, 6, 0, 0, 0], 8); // bit depth 8, colour type 6 (RGBA), deflate, no filter method, no interlace
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(filtered, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([typeBytes, data])));
  return concat([length, typeBytes, data, crc]);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---- Entry point ----

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(here, '../public/sprites');

/** Writes the sheet into `directory` as `player.png` and returns its path. */
export function writePlayerSheet(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${PLAYER_SHEET_KEY}.png`);
  writeFileSync(file, encodePng(paintPlayerSheet()));
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the sheet goes to public/sprites');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  console.log(`wrote ${writePlayerSheet(directory)}`);
}
