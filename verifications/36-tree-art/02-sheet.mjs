/**
 * V2: the committed tree sheet is what the generator produces, its layout
 * matches the tree's `standingSprite`, and every variant is a tree: a brown
 * trunk standing in the tile, a green canopy that overhangs the tile to the
 * north and to both sides, and nothing but a soft shadow outside them. The
 * variants differ from each other.
 *
 * It also writes proof/02-sheet-contact.png: the committed sheet enlarged on
 * grass, each variant alone and then a block of trees placed the way the
 * client places them. That image is drawn by this script, not by the game;
 * the screenshots of the game are 03-browser's.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PROOF, ROOT, check, run, summarize, writeProof } from './lib.mjs';

const CLIENT = path.join(ROOT, 'packages/client');
const COMMITTED = path.join(CLIENT, 'public/sprites/tree.png');
const GENERATOR = path.join(CLIENT, 'tools/generate-tree-sheet.mjs');
const TILE_PIXELS = 16;
const GRASS = [0x5c, 0x9e, 0x4a];
const results = [];
const report = {};

// The def the sheet must match, scraped from the sim's own source: the defs file is plain data.
const defsSource = readFileSync(path.join(ROOT, 'packages/sim/src/features/terrain/defs.ts'), 'utf8');
const standingSource = /standingSprite: \{([^}]*)\}/.exec(defsSource)?.[1] ?? '';
const number = (field) => Number(new RegExp(`${field}:\\s*(\\d+)`).exec(standingSource)?.[1]);
const def = { key: /key: '([^']+)'/.exec(standingSource)?.[1], frameWidth: number('frameWidth'), frameHeight: number('frameHeight'), pixelsPerMetre: number('pixelsPerMetre'), variantCount: number('variantCount') };
report.def = def;
results.push(check('exactly one terrain def has a standing sprite, and it parses', (defsSource.match(/standingSprite: \{/g) || []).length === 1 && def.key === 'tree' && [def.frameWidth, def.frameHeight, def.pixelsPerMetre, def.variantCount].every(Number.isFinite), JSON.stringify(def)));
results.push(check('the sheet is drawn at the tile scale, 16 pixels per metre, so it needs no resampling', def.pixelsPerMetre === TILE_PIXELS));

const committedBytes = readFileSync(COMMITTED);
const sheet = PNG.sync.read(committedBytes);
report.committed = { width: sheet.width, height: sheet.height, bytes: committedBytes.length };
results.push(check(`the sheet is ${def.variantCount} frames of ${def.frameWidth}x${def.frameHeight} side by side`, sheet.width === def.frameWidth * def.variantCount && sheet.height === def.frameHeight, `${sheet.width}x${sheet.height}`));

const temporary = mkdtempSync(path.join(os.tmpdir(), 'novaland-tree-'));
const generated = await run('node', [GENERATOR, '--out', temporary]);
const regenerated = generated.code === 0 ? readFileSync(path.join(temporary, 'tree.png')) : Buffer.alloc(0);
rmSync(temporary, { recursive: true, force: true });
results.push(check('the committed sheet is byte for byte what the generator writes', generated.code === 0 && regenerated.equals(committedBytes), `exit ${generated.code}, ${regenerated.length} bytes`));

const pixelAt = (variant, x, y) => {
  const offset = (y * sheet.width + variant * def.frameWidth + x) * 4;
  return { red: sheet.data[offset], green: sheet.data[offset + 1], blue: sheet.data[offset + 2], alpha: sheet.data[offset + 3] };
};
const isLeaf = ({ red, green, blue, alpha }) => alpha === 255 && green > red && green > blue;
const isWood = ({ red, green, blue, alpha }) => alpha === 255 && red > green && green > blue;
/** The canopy's one-pixel edge is its darkest green; anything opaque that is not that colour is inside the outline. */
const brightness = ({ red, green, blue }) => red + green + blue;
const everyPixel = Array.from({ length: sheet.width * sheet.height }, (_, index) => pixelAt(0, index % sheet.width, Math.floor(index / sheet.width)));
const outlineBrightness = Math.min(...everyPixel.filter(isLeaf).map(brightness));
const isInsideTheOutline = (pixel) => pixel.alpha === 255 && brightness(pixel) !== outlineBrightness;
/** The tile is the bottom-centre TILE_PIXELS square of the frame. */
const tileLeft = (def.frameWidth - TILE_PIXELS) / 2;
const tileTop = def.frameHeight - TILE_PIXELS;
const variants = [];
for (let variant = 0; variant < def.variantCount; variant += 1) {
  const count = (matches, region) => {
    let total = 0;
    for (let y = region.top; y < region.bottom; y += 1) {
      for (let x = region.left; x < region.right; x += 1) if (matches(pixelAt(variant, x, y))) total += 1;
    }
    return total;
  };
  const wholeFrame = { left: 0, right: def.frameWidth, top: 0, bottom: def.frameHeight };
  const stats = {
    leafPixels: count(isLeaf, wholeFrame),
    leafPixelsNorthOfTheTile: count(isLeaf, { ...wholeFrame, bottom: tileTop }),
    leafPixelsWestOfTheTile: count(isLeaf, { ...wholeFrame, right: tileLeft }),
    leafPixelsEastOfTheTile: count(isLeaf, { ...wholeFrame, left: tileLeft + TILE_PIXELS }),
    woodPixels: count(isWood, wholeFrame),
    woodPixelsOutsideTheTile: count(isWood, wholeFrame) - count(isWood, { left: tileLeft, right: tileLeft + TILE_PIXELS, top: tileTop, bottom: def.frameHeight }),
    woodPixelsInTheLowestRows: count(isWood, { ...wholeFrame, top: def.frameHeight - 6 }),
    leafTones: new Set(Array.from({ length: def.frameWidth * def.frameHeight }, (_, index) => pixelAt(variant, index % def.frameWidth, Math.floor(index / def.frameWidth))).filter(isLeaf).map(({ red, green, blue }) => `${red},${green},${blue}`)).size,
    partlyTransparentPixels: count(({ alpha }) => alpha > 0 && alpha < 255, wholeFrame),
    partlyTransparentPixelsAboveTheFoot: count(({ alpha }) => alpha > 0 && alpha < 255, { ...wholeFrame, bottom: def.frameHeight - 6 }),
    pixelsOnTheFrameEdgeThatAreNotOutline:
      count(isInsideTheOutline, { ...wholeFrame, right: 1 }) + count(isInsideTheOutline, { ...wholeFrame, left: def.frameWidth - 1 }) + count(isInsideTheOutline, { ...wholeFrame, bottom: 1 }),
  };
  variants.push(stats);
  const name = `variant ${variant}`;
  results.push(check(`${name}: a canopy of several green tones`, stats.leafPixels > 150 && stats.leafTones >= 4, `${stats.leafPixels} leaf pixels, ${stats.leafTones} tones`));
  results.push(check(`${name}: the canopy overhangs the tile to the north and to both sides`, stats.leafPixelsNorthOfTheTile > 100 && stats.leafPixelsWestOfTheTile > 5 && stats.leafPixelsEastOfTheTile > 5, `${stats.leafPixelsNorthOfTheTile} north, ${stats.leafPixelsWestOfTheTile} west, ${stats.leafPixelsEastOfTheTile} east`));
  results.push(check(`${name}: a brown trunk under the canopy, inside the tile, reaching the foot of the frame`, stats.woodPixels >= 16 && stats.woodPixelsOutsideTheTile === 0 && stats.woodPixelsInTheLowestRows >= 8, `${stats.woodPixels} wood pixels`));
  results.push(check(`${name}: the only see-through pixels are the shadow at the foot`, stats.partlyTransparentPixels > 0 && stats.partlyTransparentPixelsAboveTheFoot === 0, `${stats.partlyTransparentPixels} shadow pixels`));
  results.push(check(`${name}: the dark outline closes inside the frame, so nothing is cut off at its left, right or top edge`, stats.pixelsOnTheFrameEdgeThatAreNotOutline === 0));
}
report.variants = variants;
const frameBytes = (variant) => Array.from({ length: def.frameHeight }, (_, y) => sheet.data.subarray((y * sheet.width + variant * def.frameWidth) * 4, (y * sheet.width + (variant + 1) * def.frameWidth) * 4).toString('hex')).join('');
results.push(check('no two variants are the same picture', new Set(variants.map((_, variant) => frameBytes(variant))).size === def.variantCount));

writeFileSync(path.join(PROOF, '02-sheet-contact.png'), PNG.sync.write(contactSheet()));
writeProof('02-sheet.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The variants alone on grass, then a 4x3 block of trees, each standing on the bottom centre of its tile, enlarged 6x. */
function contactSheet() {
  const ENLARGED = 6;
  const columns = def.variantCount * 2 + 6;
  const rows = 5;
  const small = new PNG({ width: columns * TILE_PIXELS, height: rows * TILE_PIXELS });
  for (let offset = 0; offset < small.data.length; offset += 4) small.data.set([...GRASS, 255], offset);
  const drawTree = (variant, column, row) => {
    const left = column * TILE_PIXELS - tileLeft;
    const top = (row + 1) * TILE_PIXELS - def.frameHeight;
    for (let y = 0; y < def.frameHeight; y += 1) {
      for (let x = 0; x < def.frameWidth; x += 1) {
        const { red, green, blue, alpha } = pixelAt(variant, x, y);
        if (alpha === 0 || left + x < 0 || top + y < 0 || left + x >= small.width || top + y >= small.height) continue;
        const offset = ((top + y) * small.width + left + x) * 4;
        [red, green, blue].forEach((channel, index) => {
          small.data[offset + index] = Math.round((channel * alpha + small.data[offset + index] * (255 - alpha)) / 255);
        });
      }
    }
  };
  for (let variant = 0; variant < def.variantCount; variant += 1) drawTree(variant, 1 + variant * 2, 2);
  for (let row = 1; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) drawTree((column * 2 + row) % def.variantCount, def.variantCount * 2 + 1 + column, row);
  }
  const large = new PNG({ width: small.width * ENLARGED, height: small.height * ENLARGED });
  for (let y = 0; y < large.height; y += 1) {
    for (let x = 0; x < large.width; x += 1) {
      const source = (Math.floor(y / ENLARGED) * small.width + Math.floor(x / ENLARGED)) * 4;
      large.data.set(small.data.subarray(source, source + 4), (y * large.width + x) * 4);
    }
  }
  return large;
}
