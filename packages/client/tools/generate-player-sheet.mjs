/**
 * Generates the character sheets in public/sprites/: player.png, the sprite
 * of the player def in packages/sim/src/features/player/defs.ts, and the
 * layer sheets the client builds each look from: one body sheet per gender
 * and one hair sheet per hairstyle (LAYER_SHEETS, ADR 0018).
 *
 * The sheet is painted in the template colours of TEMPLATE_PALETTE: the
 * client swaps the skin, hair and clothes colours for the ones each player
 * picked (src/render/characterSheet.ts, whose TEMPLATE_COLORS must match;
 * the generator's test checks it), so those must not be used for anything
 * else in the figure.
 *
 * Four rows (down, up, left, right) of four 16x24 frames, at 16 pixels per
 * metre like the tiles (ADR 0019). Frame 0 of each row is the idle pose; the
 * walk cycle plays the whole row: stand, left step, passing pose (body one
 * pixel taller), right step. The frame layout must match the def's `sprite`.
 *
 * Each frame is painted in two layers: the body (legs, torso, arms, and the
 * head painted whole in skin, with the eyes) and the hair above it, so any
 * hairstyle (HAIRSTYLES) goes over any body; the outline goes around both
 * layers together. The genders (GENDERS) share one body and differ only in
 * lashes. At 16x24 a difference is a pixel or two: the long hair falls past
 * the jaw and down the back, a lash is one pixel above an eye.
 *
 * Plain Node, no dependencies: the figure is painted into an RGBA buffer and
 * written as a PNG by the small encoder at the bottom.
 *
 *   node tools/generate-player-sheet.mjs                # writes the sheets into public/sprites/
 *   node tools/generate-player-sheet.mjs --out <dir>    # writes them somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { blit, blitOpaque, createCanvas, outline, pixel } from './pixelCanvas.mjs';

export const FRAME_WIDTH = 16;
export const FRAME_HEIGHT = 24;
export const DIRECTIONS = ['down', 'up', 'left', 'right'];
export const FRAMES_PER_DIRECTION = 4;

/** Sprite key of the player def: the sheet is written as `<key>.png`. */
export const PLAYER_SHEET_KEY = 'player';

/** Colours the client never swaps. */
export const FIXED_PALETTE = {
  outline: [0x1f, 0x1a, 0x17],
  eye: [0x14, 0x12, 0x1a],
  shoe: [0x1f, 0x29, 0x37],
  pants: [0x37, 0x41, 0x51],
  pantsShade: [0x26, 0x2d, 0x3a],
};

/** Colours the client swaps for a player's look. `clothesShade` becomes a darker shade of the clothes colour. */
export const TEMPLATE_PALETTE = {
  skin: [0xf1, 0xc2, 0x7d],
  hair: [0x6b, 0x3e, 0x1e],
  clothes: [0x3b, 0x82, 0xf6],
  clothesShade: [0x2a, 0x5f, 0xc0], // hand-picked at c466e78, not derived, so player.png stays that sheet byte for byte
};

/** How the body is posed in each of the four frames of a row. `forwardLeg` is from the character's point of view. */
const POSES = [
  { bob: 0, forwardLeg: null },
  { bob: 0, forwardLeg: 'left' },
  { bob: -1, forwardLeg: null },
  { bob: 0, forwardLeg: 'right' },
];

/**
 * The genders and hairstyles, by the name the sim's `characterShapes` gives
 * them, each with the sprite key its layer sheet is written under (the
 * `sheet` of the sim's entry; the generator's test checks they agree).
 */
const LAYER_SHEETS = {
  gender: { male: 'player-body-male', female: 'player-body-female' },
  hairstyle: { short: 'player-hair-short', long: 'player-hair-long' },
};

/**
 * The whole sheet as RGBA bytes, rows top to bottom: a gender's body wearing
 * a hairstyle, outlined together. The default is what `player.png` holds.
 */
export function paintPlayerSheet({ gender = PLAYER_GENDER, hairstyle = PLAYER_HAIRSTYLE } = {}) {
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      const { body, hair } = paintFrameLayers(direction, pose, { gender, hairstyle });
      const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
      blitOpaque(frame, body);
      blitOpaque(frame, hair);
      outline(frame, FIXED_PALETTE.outline);
      blit(sheet, frame, column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/**
 * One layer of every frame, unoutlined, in the sheet's layout: what a
 * gender's body sheet (`layer` 'body') or a hairstyle's sheet ('hair') holds.
 * The client lays a hair sheet over a body sheet and outlines the two together.
 */
function paintLayerSheet(layer, { gender = PLAYER_GENDER, hairstyle = PLAYER_HAIRSTYLE } = {}) {
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      blit(sheet, paintFrameLayers(direction, pose, { gender, hairstyle })[layer], column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/** Last row of the figure. Its outline takes the row below; the bottom row of the frame stays clear. */
const FEET_ROW = 21;

/**
 * One frame's two layers, unoutlined, each the size of a frame: the body of
 * `gender` (a key of GENDERS), and the hair of `hairstyle` (a key of
 * HAIRSTYLES) that goes over it.
 */
function paintFrameLayers(direction, pose, { gender = PLAYER_GENDER, hairstyle = PLAYER_HAIRSTYLE } = {}) {
  if (!GENDERS[gender]) throw new Error(`no gender '${gender}'`);
  if (!HAIRSTYLES[hairstyle]) throw new Error(`no hairstyle '${hairstyle}'`);
  const colors = { ...FIXED_PALETTE, ...TEMPLATE_PALETTE };
  const top = 3 + pose.bob; // first row of the head; the rows above hold the outline and a clear margin
  const torsoTop = top + 9; // the neck sits on the row between head and torso
  const body = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  paintLegs(body, colors, { direction, pose, top: torsoTop + 5 });
  paintTorsoAndArms(body, colors, { direction, pose, top: torsoTop });
  paintHead(body, colors, { direction, top, lashes: GENDERS[gender].lashes });
  const hair = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  for (const [x, y, width, height] of HAIRSTYLES[hairstyle][direction]) rect(hair, x, top + y, width, height, colors.hair);
  return { body, hair };
}

/**
 * The head on the body layer: a skull 8 wide (columns 4-11) and 8 tall, the
 * top and bottom rows one pixel narrower, painted whole in skin so taking the
 * hair away leaves a bald head; then the eyes, and the lashes of a gender
 * that has them.
 */
function paintHead(frame, colors, { direction, top, lashes }) {
  rect(frame, 5, top, 6, 1, colors.skin);
  rect(frame, 4, top + 1, 8, 6, colors.skin);
  rect(frame, 5, top + 7, 6, 1, colors.skin);
  for (const [x, y] of EYES[direction]) pixel(frame, x, top + y, colors.eye);
  if (lashes) for (const [x, y] of LASHES[direction]) pixel(frame, x, top + y, colors.eye);
}

/** The eyes, one pixel each, as a column and a row from the head's first. Seen from behind there are none. */
const EYES = {
  down: [
    [6, 5],
    [9, 5],
  ],
  up: [],
  left: [[5, 5]],
  right: [[10, 5]],
};

/** Lashes: one pixel of the eyes' colour on top of each eye, so the eye reads taller and open. */
const LASHES = {
  down: [
    [6, 4],
    [9, 4],
  ],
  up: [],
  left: [[5, 4]],
  right: [[10, 4]],
};

/**
 * Hairstyles: for each direction, the rectangles of hair, as [column, row
 * from the head's first, width, height], painted on the hair layer over the
 * skull. A new hairstyle is a new entry; the sheet wears `PLAYER_HAIRSTYLE`.
 * Hair may stand past the skull (the outline goes around it), within the
 * frame's clear margin.
 */
const SHORT_HAIR = {
  // The crown, two rows down the sides of the face from the front, the whole back of the head from behind.
  down: [
    [5, 0, 6, 1],
    [4, 1, 8, 2],
    [4, 3, 1, 2],
    [11, 3, 1, 2],
  ],
  up: [
    [5, 0, 6, 1],
    [4, 1, 8, 6],
    [5, 7, 6, 1],
  ],
  left: [
    [5, 0, 6, 1],
    [4, 1, 8, 2],
    [8, 3, 4, 4],
    [9, 7, 2, 1],
  ],
};

/**
 * Long hair: the short hair, falling further. From the front the sides reach
 * past the jaw to the shoulders; from behind and in profile it keeps the
 * back of the head's width down past the nape and ends two rows into the
 * back of the shirt.
 */
const LONG_HAIR = {
  down: [...SHORT_HAIR.down, [4, 5, 1, 4], [11, 5, 1, 4]],
  up: [...SHORT_HAIR.up, [4, 7, 8, 2], [5, 9, 6, 2]],
  left: [...SHORT_HAIR.left, [9, 7, 3, 2], [10, 9, 2, 2]],
};

const HAIRSTYLES = {
  short: withRightProfile(SHORT_HAIR),
  long: withRightProfile(LONG_HAIR),
};

const PLAYER_HAIRSTYLE = 'short';

/** A hairstyle with its right profile: the left one mirrored across the frame. */
function withRightProfile(hairstyle) {
  return { ...hairstyle, right: hairstyle.left.map(([x, y, width, height]) => [FRAME_WIDTH - x - width, y, width, height]) };
}

/**
 * The genders. They share one body; the female face has lashes. Which
 * hairstyle each suggests is the sim's (`defaultHairStyle`), not the art's.
 */
const GENDERS = {
  male: { lashes: false },
  female: { lashes: true },
};
const PLAYER_GENDER = 'male';

function paintTorsoAndArms(frame, colors, { direction, pose, top }) {
  rect(frame, 7, top - 1, 2, 1, colors.skin); // neck
  rect(frame, 5, top, 6, 5, direction === 'up' ? colors.clothesShade : colors.clothes);
  const swing = pose.forwardLeg === 'left' ? 1 : pose.forwardLeg === 'right' ? -1 : 0;
  if (direction === 'down' || direction === 'up') {
    // The arm opposite the forward leg swings forward (drawn one pixel lower), the other one back (higher).
    const [leftArm, rightArm] = direction === 'down' ? [11, 4] : [4, 11];
    paintArm(frame, colors, leftArm, top - swing);
    paintArm(frame, colors, rightArm, top + swing);
  } else {
    // In profile only the near arm shows, swinging along the walk.
    const column = direction === 'left' ? 7 - swing : 8 + swing;
    paintArm(frame, colors, column, top);
  }
}

function paintArm(frame, colors, column, top) {
  rect(frame, column, top, 1, 3, colors.clothesShade);
  rect(frame, column, top + 3, 1, 2, colors.skin);
}

function paintLegs(frame, colors, { direction, pose, top }) {
  if (direction === 'down' || direction === 'up') {
    // Front and back view: the lifted leg is one pixel shorter, the planted one keeps its length.
    const [leftColumn, rightColumn] = direction === 'down' ? [8, 5] : [5, 8];
    paintLeg(frame, colors, { column: leftColumn, top, lift: pose.forwardLeg === 'right' ? 1 : 0, pantsColor: colors.pants });
    paintLeg(frame, colors, { column: rightColumn, top, lift: pose.forwardLeg === 'left' ? 1 : 0, pantsColor: colors.pants });
    return;
  }
  // Profile: the legs spread apart along the walk. The far leg is drawn first and darker.
  const ahead = direction === 'left' ? -1 : 1;
  const spread = pose.forwardLeg === null ? 0 : pose.forwardLeg === 'left' ? ahead : -ahead;
  paintLeg(frame, colors, { column: 7 - spread, top, lift: 0, pantsColor: colors.pantsShade });
  paintLeg(frame, colors, { column: 6 + spread, top, lift: 0, pantsColor: colors.pants });
}

/** A 3-wide leg from `top` down to the feet row: pants then a 2-row shoe, `lift` pixels off the ground. */
function paintLeg(frame, colors, { column, top, lift, pantsColor }) {
  const bottom = FEET_ROW - lift;
  rect(frame, column, top, 3, bottom - 1 - top, pantsColor);
  rect(frame, column, bottom - 1, 3, 2, colors.shoe);
}

function rect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) pixel(canvas, column, row, color);
  }
}

export const __testing__ = { GENDERS, HAIRSTYLES, LAYER_SHEETS, paintFrameLayers, paintLayerSheet, POSES };

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

/**
 * Writes the sheets into `directory` and returns their paths: `player.png`
 * (the first gender wearing the first hairstyle, outlined: what the def
 * names, and what the client draws if it cannot lay the layers), then one
 * layer sheet per gender (its body) and per hairstyle.
 */
export function writePlayerSheet(directory) {
  mkdirSync(directory, { recursive: true });
  const write = (key, canvas) => {
    const file = path.join(directory, `${key}.png`);
    writeFileSync(file, encodePng(canvas));
    return file;
  };
  return [
    write(PLAYER_SHEET_KEY, paintPlayerSheet()),
    ...Object.entries(LAYER_SHEETS.gender).map(([gender, key]) => write(key, paintLayerSheet('body', { gender }))),
    ...Object.entries(LAYER_SHEETS.hairstyle).map(([hairstyle, key]) => write(key, paintLayerSheet('hair', { hairstyle }))),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the sheets go to public/sprites');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  for (const file of writePlayerSheet(directory)) console.log(`wrote ${file}`);
}
