/**
 * V2: the committed placeholder sheet is what the generator produces, its
 * layout matches the player's sprite def, and the frames are really
 * distinct (a walk cycle that does not change frames would be invisible).
 * The PNG is decoded by hand: the generator writes 8-bit RGBA with no
 * filtering, which is all this needs.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const CLIENT = path.join(ROOT, 'packages/client');
const COMMITTED = path.join(CLIENT, 'public/sprites/player.png');
const GENERATOR = path.join(CLIENT, 'tools/generate-player-sheet.mjs');
const results = [];
const report = {};

// The def the sheet must match, read from the sim's own source through tsx-free means: the client bundle is not needed, the defs file is plain data.
const defsSource = readFileSync(path.join(ROOT, 'packages/sim/src/features/player/defs.ts'), 'utf8');
const number = (field) => Number(new RegExp(`${field}:\\s*(\\d+)`).exec(defsSource)?.[1]);
const def = { frameWidth: number('frameWidth'), frameHeight: number('frameHeight'), pixelsPerMetre: number('pixelsPerMetre') };
const directions = {};
for (const [, name, idle, start, end] of defsSource.matchAll(/(down|up|left|right): \{ idle: (\d+), walk: \{ start: (\d+), end: (\d+) \} \}/g)) {
  directions[name] = { idle: Number(idle), walk: { start: Number(start), end: Number(end) } };
}
report.def = { ...def, directions };
results.push(check('the player def declares 16x24 frames at 16 px/m with four directions', def.frameWidth === 16 && def.frameHeight === 24 && def.pixelsPerMetre === 16 && Object.keys(directions).length === 4));

const committed = decodePng(readFileSync(COMMITTED));
report.committed = { width: committed.width, height: committed.height, bytes: readFileSync(COMMITTED).length };
const columns = committed.width / def.frameWidth;
const rows = committed.height / def.frameHeight;
results.push(check('the sheet is a whole number of 16x24 frames: 4 columns x 4 rows', columns === 4 && rows === 4, `${committed.width}x${committed.height}`));
const frameCount = columns * rows;
const everyFrameInRange = Object.values(directions).every((d) => d.idle >= 0 && d.idle < frameCount && d.walk.start <= d.walk.end && d.walk.end < frameCount);
results.push(check('every idle frame and walk range of the def exists on the sheet', everyFrameInRange));
const distinctRows = new Set(Object.values(directions).map((d) => Math.floor(d.idle / columns))).size === 4;
results.push(check('each direction uses its own row of the sheet', distinctRows));

// Regenerate into a temp dir and compare pixels, not bytes, so a different zlib still passes.
const temp = mkdtempSync(path.join(os.tmpdir(), 'novaland-sheet-'));
try {
  const output = path.join(temp, 'player.png');
  const generated = await run('node', [GENERATOR, output], { cwd: CLIENT });
  results.push(check('the generator runs with plain node and no dependencies', generated.code === 0, generated.output.trim().slice(0, 120)));
  const regenerated = decodePng(readFileSync(output));
  results.push(check('the committed sheet is pixel-identical to a fresh run of the generator', regenerated.width === committed.width && regenerated.height === committed.height && equalBytes(regenerated.pixels, committed.pixels)));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const frames = [];
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) frames.push(frameKey(committed, column, row, def.frameWidth, def.frameHeight));
}
const opaque = frames.map((frame) => frame.opaque);
results.push(check('every frame has a drawn figure (at least 100 opaque pixels)', opaque.every((count) => count >= 100), `min ${Math.min(...opaque)}`));
results.push(check(`all ${frames.length} frames are pairwise distinct`, new Set(frames.map((frame) => frame.hash)).size === frames.length));
const transparentEdge = frames.every((frame) => frame.transparentBorder);
results.push(check('no frame touches its edge, so neighbouring frames never bleed into each other', transparentEdge));
report.frames = frames.map((frame, index) => ({ index, opaque: frame.opaque, hash: frame.hash }));
writeProof('02-sheet.json', report);
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

function frameKey(image, column, row, frameWidth, frameHeight) {
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
