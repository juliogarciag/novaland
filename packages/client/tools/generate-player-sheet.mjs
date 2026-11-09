/**
 * Generates the placeholder avatar sheets at public/sprites/player-<avatar>.png,
 * one per entry of AVATAR_PALETTES below. The keys must match the sprite keys
 * of the player avatar defs in packages/sim/src/features/player/defs.ts.
 *
 * Every sheet is the same character in another palette (shirt, hair, skin,
 * pants): four rows (down, up, left, right) of four 16x24 frames. Frame 0 of
 * each row is the idle pose; the walk cycle plays the whole row: stand, left
 * step, passing pose (body one pixel taller), right step. The frame layout
 * must match the avatars' `sprite` def.
 *
 * Plain Node, no dependencies: the figure is painted into an RGBA buffer and
 * written as a PNG by the small encoder at the bottom.
 *
 *   node tools/generate-player-sheet.mjs                # writes every sheet into public/sprites/
 *   node tools/generate-player-sheet.mjs --out <dir>    # writes them somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const FRAME_WIDTH = 16;
export const FRAME_HEIGHT = 24;
export const DIRECTIONS = ['down', 'up', 'left', 'right'];
export const FRAMES_PER_DIRECTION = 4;

/** Colours every avatar shares. */
const COMMON = {
  outline: [0x1f, 0x1a, 0x17],
  eye: [0x14, 0x12, 0x1a],
  shoe: [0x1f, 0x29, 0x37],
};

/** One palette per avatar, keyed by sprite key. The shirt colour is also the def's `color` in the sim. */
export const AVATAR_PALETTES = {
  'player-sky': { skin: [0xf1, 0xc2, 0x7d], hair: [0x6b, 0x3e, 0x1e], shirt: [0x3b, 0x82, 0xf6], shirtShade: [0x2a, 0x5f, 0xc0], pants: [0x37, 0x41, 0x51], pantsShade: [0x26, 0x2d, 0x3a] },
  'player-rose': { skin: [0x8d, 0x55, 0x24], hair: [0x1f, 0x1a, 0x17], shirt: [0xe1, 0x1d, 0x48], shirtShade: [0xbe, 0x12, 0x3c], pants: [0x1e, 0x29, 0x3b], pantsShade: [0x16, 0x1f, 0x2e] },
  'player-moss': { skin: [0xff, 0xdb, 0xac], hair: [0xd9, 0x77, 0x06], shirt: [0x16, 0xa3, 0x4a], shirtShade: [0x15, 0x80, 0x3d], pants: [0x57, 0x53, 0x4e], pantsShade: [0x3f, 0x3c, 0x38] },
  'player-sun': { skin: [0xc6, 0x86, 0x42], hair: [0x1f, 0x1a, 0x17], shirt: [0xf5, 0x9e, 0x0b], shirtShade: [0xd9, 0x77, 0x06], pants: [0x37, 0x41, 0x51], pantsShade: [0x26, 0x2d, 0x3a] },
  'player-plum': { skin: [0xf1, 0xc2, 0x7d], hair: [0xf3, 0xe5, 0xab], shirt: [0x7c, 0x3a, 0xed], shirtShade: [0x6d, 0x28, 0xd9], pants: [0x2f, 0x2f, 0x3f], pantsShade: [0x21, 0x21, 0x2e] },
  'player-ember': { skin: [0xe0, 0xac, 0x69], hair: [0x3b, 0x2f, 0x2f], shirt: [0xea, 0x58, 0x0c], shirtShade: [0xc2, 0x41, 0x0c], pants: [0x44, 0x40, 0x3c], pantsShade: [0x2f, 0x2c, 0x29] },
  'player-teal': { skin: [0xff, 0xdb, 0xac], hair: [0x6b, 0x72, 0x80], shirt: [0x0d, 0x94, 0x88], shirtShade: [0x0f, 0x76, 0x6e], pants: [0x4b, 0x3a, 0x2f], pantsShade: [0x35, 0x29, 0x21] },
  'player-slate': { skin: [0x8d, 0x55, 0x24], hair: [0xb4, 0x53, 0x09], shirt: [0x47, 0x55, 0x69], shirtShade: [0x33, 0x41, 0x55], pants: [0x1e, 0x29, 0x3b], pantsShade: [0x16, 0x1f, 0x2e] },
};

/** How the body is posed in each of the four frames of a row. `forwardLeg` is from the character's point of view. */
const POSES = [
  { bob: 0, forwardLeg: null },
  { bob: 0, forwardLeg: 'left' },
  { bob: -1, forwardLeg: null },
  { bob: 0, forwardLeg: 'right' },
];

/** The whole sheet of one avatar as RGBA bytes, rows top to bottom. */
export function paintPlayerSheet(palette) {
  const colors = { ...COMMON, ...palette };
  const sheet = createCanvas(FRAME_WIDTH * FRAMES_PER_DIRECTION, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    POSES.forEach((pose, column) => {
      const frame = paintFrame(colors, direction, pose);
      blit(sheet, frame, column * FRAME_WIDTH, row * FRAME_HEIGHT);
    });
  });
  return sheet;
}

/** Last row of the figure. Its outline takes the row below; the bottom row of the frame stays clear. */
const FEET_ROW = 21;

function paintFrame(colors, direction, pose) {
  const frame = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  const top = 3 + pose.bob; // first hair row; the rows above hold the outline and a clear margin
  const torsoTop = top + 9; // the neck sits on the row between head and torso
  paintLegs(frame, colors, { direction, pose, top: torsoTop + 5 });
  paintTorsoAndArms(frame, colors, { direction, pose, top: torsoTop });
  paintHead(frame, colors, direction, top);
  outline(frame, colors.outline);
  return frame;
}

function paintHead(frame, colors, direction, top) {
  // Skull: 8 wide (columns 4-11), 8 tall, with the top and bottom rows one pixel narrower.
  rect(frame, 5, top, 6, 1, colors.hair);
  rect(frame, 4, top + 1, 8, 2, colors.hair);
  rect(frame, 4, top + 3, 8, 4, colors.skin);
  rect(frame, 5, top + 7, 6, 1, colors.skin);
  switch (direction) {
    case 'down':
      rect(frame, 4, top + 3, 1, 2, colors.hair);
      rect(frame, 11, top + 3, 1, 2, colors.hair);
      pixel(frame, 6, top + 5, colors.eye);
      pixel(frame, 9, top + 5, colors.eye);
      break;
    case 'up':
      rect(frame, 4, top + 3, 8, 4, colors.hair);
      rect(frame, 5, top + 7, 6, 1, colors.hair);
      break;
    case 'left':
      rect(frame, 8, top + 3, 4, 4, colors.hair);
      rect(frame, 9, top + 7, 2, 1, colors.hair);
      pixel(frame, 5, top + 5, colors.eye);
      break;
    case 'right':
      rect(frame, 4, top + 3, 4, 4, colors.hair);
      rect(frame, 5, top + 7, 2, 1, colors.hair);
      pixel(frame, 10, top + 5, colors.eye);
      break;
  }
}

function paintTorsoAndArms(frame, colors, { direction, pose, top }) {
  rect(frame, 7, top - 1, 2, 1, colors.skin); // neck
  rect(frame, 5, top, 6, 5, direction === 'up' ? colors.shirtShade : colors.shirt);
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
  rect(frame, column, top, 1, 3, colors.shirtShade);
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

// ---- Pixel canvas ----

function createCanvas(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function pixel(canvas, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error(`pixel (${x}, ${y}) is outside the ${canvas.width}x${canvas.height} frame`);
  const offset = (y * canvas.width + x) * 4;
  canvas.data[offset] = r;
  canvas.data[offset + 1] = g;
  canvas.data[offset + 2] = b;
  canvas.data[offset + 3] = 255;
}

function rect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) pixel(canvas, column, row, color);
  }
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

/** Writes every avatar sheet into `directory` as `<key>.png` and returns the paths. */
export function writeAvatarSheets(directory) {
  mkdirSync(directory, { recursive: true });
  return Object.entries(AVATAR_PALETTES).map(([key, palette]) => {
    const file = path.join(directory, `${key}.png`);
    writeFileSync(file, encodePng(paintPlayerSheet(palette)));
    return file;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  const directory = outFlag >= 0 && process.argv[outFlag + 1] ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  for (const file of writeAvatarSheets(directory)) console.log(`wrote ${file}`);
}
