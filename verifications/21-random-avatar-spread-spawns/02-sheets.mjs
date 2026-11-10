/**
 * V2: every avatar def has a committed sheet, the sheets are what the generator
 * produces, they all share the layout the defs declare, and they really look
 * different from each other (a palette variant that paints the same pixels
 * would make two players indistinguishable). The PNGs are decoded by hand:
 * the generator writes 8-bit RGBA with no filtering, which is all this needs.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const CLIENT = path.join(ROOT, 'packages/client');
const SPRITES = path.join(CLIENT, 'public/sprites');
const GENERATOR = path.join(CLIENT, 'tools/generate-player-sheet.mjs');
const results = [];
const report = {};

// The avatar keys and frame layout, scraped from the sim's defs file (plain data, no build needed), and the
// generator's palette keys, read from its export. Both lists must agree or a player would have no sheet.
const defsSource = readFileSync(path.join(ROOT, 'packages/sim/src/features/player/defs.ts'), 'utf8');
const avatarKeys = [...defsSource.matchAll(/name: '(player-[a-z]+)'/g)].map((match) => match[1]);
const number = (field) => Number(new RegExp(`${field}:\\s*(\\d+)`).exec(defsSource)?.[1]);
const layout = { frameWidth: number('frameWidth'), frameHeight: number('frameHeight'), pixelsPerMetre: number('pixelsPerMetre') };
const directions = {};
for (const [, name, idle, start, end] of defsSource.matchAll(/(down|up|left|right): \{ idle: (\d+), walk: \{ start: (\d+), end: (\d+) \} \}/g)) {
  directions[name] = { idle: Number(idle), walk: { start: Number(start), end: Number(end) } };
}
const { AVATAR_PALETTES } = await import(GENERATOR);
const paletteKeys = Object.keys(AVATAR_PALETTES);
report.avatarKeys = avatarKeys;
report.paletteKeys = paletteKeys;
report.layout = { ...layout, directions };
results.push(check('the player defs declare at least 8 avatars with distinct sprite keys', avatarKeys.length >= 8 && new Set(avatarKeys).size === avatarKeys.length, avatarKeys.join(', ')));
results.push(check('the generator has one palette per avatar def, under the same keys', paletteKeys.length === avatarKeys.length && avatarKeys.every((key) => paletteKeys.includes(key))));
results.push(check('every avatar shares one layout: 16x24 frames at 16 px/m with four directions', layout.frameWidth === 16 && layout.frameHeight === 24 && layout.pixelsPerMetre === 16 && Object.keys(directions).length === 4));

const committedSheets = new Map();
for (const key of avatarKeys) {
  const file = path.join(SPRITES, `${key}.png`);
  if (existsSync(file)) committedSheets.set(key, decodePng(readFileSync(file)));
}
results.push(check('a sheet is committed under public/sprites for every avatar key', committedSheets.size === avatarKeys.length, `${committedSheets.size}/${avatarKeys.length}`));
const columns = 4;
const rows = 4;
results.push(check('every sheet is 4 columns x 4 rows of the declared frame size', [...committedSheets.values()].every((sheet) => sheet.width === layout.frameWidth * columns && sheet.height === layout.frameHeight * rows)));
const frameCount = columns * rows;
results.push(check('every idle frame and walk range of the defs exists on the sheets', Object.values(directions).every((frames) => frames.idle >= 0 && frames.idle < frameCount && frames.walk.start <= frames.walk.end && frames.walk.end < frameCount)));
results.push(check('each direction uses its own row of the sheet', new Set(Object.values(directions).map((frames) => Math.floor(frames.idle / columns))).size === 4));

// Regenerate into a temp dir and compare pixels, not bytes, so a different zlib still passes.
const temp = mkdtempSync(path.join(os.tmpdir(), 'novaland-sheets-'));
try {
  const generated = await run('node', [GENERATOR, '--out', temp], { cwd: CLIENT });
  results.push(check('the generator runs with plain node and no dependencies', generated.code === 0, generated.output.trim().split('\n').length + ' lines'));
  const identical = avatarKeys.every((key) => {
    const committed = committedSheets.get(key);
    const file = path.join(temp, `${key}.png`);
    if (!committed || !existsSync(file)) return false;
    const regenerated = decodePng(readFileSync(file));
    return regenerated.width === committed.width && regenerated.height === committed.height && equalBytes(regenerated.pixels, committed.pixels);
  });
  results.push(check('every committed sheet is pixel-identical to a fresh run of the generator', identical));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

report.sheets = {};
const sheetHashes = new Set();
let framesDrawn = true;
let framesDistinct = true;
let edgesClear = true;
for (const [key, sheet] of committedSheets) {
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) frames.push(describeFrame(sheet, { column, row, frameWidth: layout.frameWidth, frameHeight: layout.frameHeight }));
  }
  if (!frames.every((frame) => frame.opaque >= 100)) framesDrawn = false;
  if (new Set(frames.map((frame) => frame.hash)).size !== frames.length) framesDistinct = false;
  if (!frames.every((frame) => frame.transparentBorder)) edgesClear = false;
  const sheetHash = frames.map((frame) => frame.hash).join('');
  sheetHashes.add(sheetHash);
  report.sheets[key] = { frames: frames.map((frame, index) => ({ index, opaque: frame.opaque, hash: frame.hash })), idleDownColours: distinctColours(sheet, { column: 0, row: 0, frameWidth: layout.frameWidth, frameHeight: layout.frameHeight }) };
}
results.push(check('every frame of every sheet has a drawn figure (at least 100 opaque pixels)', framesDrawn));
results.push(check('within each sheet all 16 frames are pairwise distinct', framesDistinct));
results.push(check('no frame touches its edge, so neighbouring frames never bleed into each other', edgesClear));
results.push(check(`the ${committedSheets.size} sheets are pairwise different pictures`, sheetHashes.size === committedSheets.size));
const silhouettesAgree = new Set([...committedSheets.values()].map((sheet) => silhouetteHash(sheet))).size === 1;
results.push(check('every sheet is the same character (identical silhouette), only the palette changes', silhouettesAgree));
writeProof('02-sheets.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (bytes[offset + 16] !== 8 || bytes[offset + 17] !== 6) throw new Error('expected 8-bit RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('expected unfiltered scanlines');
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, pixels };
}

function equalBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Opaque pixel count, content hash and whether the frame keeps a transparent edge. */
function describeFrame(image, { column, row, frameWidth, frameHeight }) {
  let opaque = 0;
  let hash = 0x811c9dc5;
  let transparentBorder = true;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = ((row * frameHeight + y) * image.width + column * frameWidth + x) * 4;
      const alpha = image.pixels[offset + 3];
      if (alpha) opaque += 1;
      if (alpha && (x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1)) transparentBorder = false;
      for (let channel = 0; channel < 4; channel += 1) {
        hash ^= image.pixels[offset + channel];
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
  }
  return { opaque, hash: hash.toString(16).padStart(8, '0'), transparentBorder };
}

/** Hash of the alpha channel alone: which pixels are painted, whatever their colour. */
function silhouetteHash(image) {
  let hash = 0x811c9dc5;
  for (let offset = 3; offset < image.pixels.length; offset += 4) {
    hash ^= image.pixels[offset];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The distinct opaque colours of one frame, as hex, for the report. */
function distinctColours(image, { column, row, frameWidth, frameHeight }) {
  const colours = new Set();
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = ((row * frameHeight + y) * image.width + column * frameWidth + x) * 4;
      if (image.pixels[offset + 3]) colours.add('#' + [0, 1, 2].map((channel) => image.pixels[offset + channel].toString(16).padStart(2, '0')).join(''));
    }
  }
  return [...colours].sort();
}
