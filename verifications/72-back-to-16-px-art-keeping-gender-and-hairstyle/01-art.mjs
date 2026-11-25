/**
 * The art and the numbers that size it, checked against `c466e78` (main before
 * #67, #68 and #69) without a browser: the terrain sheets and player.png are
 * that commit's bytes, the files that turn metres into pixels are that
 * commit's files, and the layer sheets of every gender and hairstyle are
 * 16x24 frames the generator paints today. Writes a contact sheet of every
 * pairing in all four directions and four walk frames.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROOF, ROOT, check, summarize, writeProof } from './lib.mjs';

const BEFORE_32_PX = 'c466e78';
const SPRITES = 'packages/client/public/sprites';
const results = [];
const report = {};

const generator = await import(path.join(ROOT, 'packages/client/tools/generate-player-sheet.mjs'));

// The sheets the human liked, byte for byte.
for (const key of ['grass', 'water', 'shallows', 'tree', 'rock', 'player']) {
  const file = `${SPRITES}/${key}.png`;
  const same = readFileSync(path.join(ROOT, file)).equals(gitShow(`${BEFORE_32_PX}:${file}`));
  results.push(check(`${key}.png is ${BEFORE_32_PX}'s, byte for byte`, same));
}

// What decides how big a metre, a tile, a name and the view are.
const SIZING_FILES = [
  'packages/client/src/render/units.ts',
  'packages/client/src/render/zoom.ts',
  'packages/client/src/render/nameLabel.ts',
  'packages/client/src/render/groundTiles.ts',
  'packages/client/src/render/terrain.ts',
  'packages/sim/src/features/terrain/defs.ts',
  'packages/client/tools/generate-grass-sheet.mjs',
  'packages/client/tools/generate-water-sheet.mjs',
  'packages/client/tools/generate-tree-sheet.mjs',
  'packages/client/tools/generate-rock-sheet.mjs',
];
for (const file of SIZING_FILES) {
  const same = readFileSync(path.join(ROOT, file)).equals(gitShow(`${BEFORE_32_PX}:${file}`));
  results.push(check(`${file} is ${BEFORE_32_PX}'s`, same));
}

// The layer sheets: 16x24 frames, four directions by four walk frames, as committed and as the generator paints them now.
const fresh = mkdtempSync(path.join(os.tmpdir(), 'novaland-72-'));
const written = generator.writePlayerSheet(fresh).map((file) => path.basename(file));
report.sheets = {};
for (const name of written) {
  const committed = readFileSync(path.join(ROOT, SPRITES, name));
  const size = pngSize(committed);
  report.sheets[name] = size;
  results.push(check(`${name} is ${size.width}x${size.height}: 4x4 frames of 16x24`, size.width === 64 && size.height === 96));
  results.push(check(`${name} is what the generator paints today`, committed.equals(readFileSync(path.join(fresh, name)))));
}
const expectedSheets = ['player-body-male.png', 'player-body-female.png', 'player-hair-short.png', 'player-hair-long.png'];
results.push(check('a body sheet per gender and a hair sheet per hairstyle', expectedSheets.every((name) => written.includes(name)), written.join(', ')));

// Contact sheet: male short, male long, female short, female long, each the generator's outlined sheet, on grass, 6x.
writeFileSync(path.join(PROOF, '01-every-look.png'), generator.encodePng(contactSheet()));

report.results = results;
writeProof('01-art.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function gitShow(spec) {
  return execFileSync('git', ['show', spec], { cwd: ROOT, maxBuffer: 1 << 24 });
}

function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function contactSheet() {
  const pairs = [
    ['male', 'short'],
    ['male', 'long'],
    ['female', 'short'],
    ['female', 'long'],
  ];
  const scale = 6;
  const gap = 4;
  const sheets = pairs.map(([gender, hairstyle]) => generator.paintPlayerSheet({ gender, hairstyle }));
  const { width, height } = sheets[0];
  const out = { width: (width + gap) * pairs.length * scale, height: height * scale };
  out.data = new Uint8Array(out.width * out.height * 4);
  for (let offset = 0; offset < out.data.length; offset += 4) out.data.set([0x5c, 0x9e, 0x4a, 255], offset);
  sheets.forEach((sheet, index) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = (y * width + x) * 4;
        if (sheet.data[source + 3] !== 255) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) out.data.set(sheet.data.subarray(source, source + 4), ((y * scale + dy) * out.width + (index * (width + gap) + x) * scale + dx) * 4);
        }
      }
    }
  });
  return out;
}
