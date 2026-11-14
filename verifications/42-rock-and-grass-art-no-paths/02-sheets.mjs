/**
 * V2: the committed sheets are what their generators write, and they are
 * what the ticket asks for.
 *
 * - `rock.png`, `grass.png` and `tree.png` are byte for byte the output of
 *   their generators (the tree's too: its generator now shares its pixel
 *   canvas with the other two and must paint the same tree).
 * - Every rock variant is a grey lump with a dark edge, sunk into the
 *   ground: its lowest row is grass in the grass sheet's own greens and
 *   nothing is drawn under it. The variants differ.
 * - Every grass tile is opaque and textured all over, but calmly: no 6x6
 *   patch of any tile is one flat colour, between a tenth and a third of
 *   its pixels are blades, and the blades are close to the turf in tone.
 *   The tiles differ, and only a few carry a flower.
 *
 * It also writes proof/02-sheets-contact.png: the committed sheets enlarged,
 * then a field laid out the way the client lays it out. That image is drawn
 * by this script, not by the game; the screenshots of the game are 03-browser's.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PROOF, ROOT, check, summarize, writeProof } from './lib.mjs';

const CLIENT = path.join(ROOT, 'packages/client');
const TILE_PIXELS = 16;
const results = [];
const report = {};

// The sprites the sheets must match, scraped from the sim's own source: the defs file is plain data.
const defsSource = readFileSync(path.join(ROOT, 'packages/sim/src/features/terrain/defs.ts'), 'utf8');
const spriteOf = (defName, field) => {
  const defSource = new RegExp(`name: '${defName}'[^]*?${field}: \\{([^}]*)\\}`).exec(defsSource)?.[1] ?? '';
  return Object.fromEntries([...defSource.matchAll(/(\w+):\s*(\d+)/g)].map(([, key, value]) => [key, Number(value)]));
};
const ROCK = spriteOf('rock', 'standingSprite');
const GRASS = spriteOf('grass', 'groundSprite');
const TREE = spriteOf('tree', 'standingSprite');
report.sprites = { rock: ROCK, grass: GRASS, tree: TREE };

// ---- Committed sheets are the generators' output ----
const scratch = mkdtempSync(path.join(os.tmpdir(), 'novaland-42-sheets-'));
const sheets = {};
for (const name of ['rock', 'grass', 'tree']) {
  const generated = spawnSync('node', [path.join(CLIENT, `tools/generate-${name}-sheet.mjs`), '--out', scratch], { encoding: 'utf8' });
  const committed = readFileSync(path.join(CLIENT, `public/sprites/${name}.png`));
  const same = generated.status === 0 && committed.equals(readFileSync(path.join(scratch, `${name}.png`)));
  results.push(check(`public/sprites/${name}.png is byte for byte what generate-${name}-sheet.mjs writes`, same, `${committed.length} bytes`));
  sheets[name] = PNG.sync.read(committed);
}
rmSync(scratch, { recursive: true, force: true });

// ---- Rock ----
results.push(check('the rock sheet has `variantCount` frames of the declared size side by side', sheets.rock.width === ROCK.frameWidth * ROCK.variantCount && sheets.rock.height === ROCK.frameHeight, `${sheets.rock.width}x${sheets.rock.height}`));
results.push(check('a rock frame is as wide as its one-metre tile and taller than it', ROCK.frameWidth === ROCK.pixelsPerMetre && ROCK.frameHeight > ROCK.pixelsPerMetre, `${ROCK.frameWidth}x${ROCK.frameHeight} at ${ROCK.pixelsPerMetre} px/m`));
const rockFrames = Array.from({ length: ROCK.variantCount }, (_, variant) => frameOf(sheets.rock, { variant, width: ROCK.frameWidth, height: ROCK.frameHeight }));
report.rocks = rockFrames.map((frame) => {
  const opaque = frame.pixels.filter((pixel) => pixel.alpha === 255);
  const greys = new Set(opaque.filter((pixel) => isGrey(pixel)).map((pixel) => pixel.colour));
  const rows = opaque.map((pixel) => pixel.y);
  const bottomRow = Math.max(...rows);
  const foot = opaque.filter((pixel) => pixel.y === bottomRow);
  return { opaquePixels: opaque.length, greyTones: greys.size, greyShare: opaque.filter((pixel) => isGrey(pixel)).length / opaque.length, topRow: Math.min(...rows), bottomRow, footPixels: foot.length, footColours: [...new Set(foot.map((pixel) => pixel.colour))], translucentPixels: frame.pixels.filter((pixel) => pixel.alpha > 0 && pixel.alpha < 255).length };
});
results.push(check('every rock variant is a solid lump: at least a third of the tile, opaque', report.rocks.every((rock) => rock.opaquePixels >= (TILE_PIXELS * TILE_PIXELS) / 3), report.rocks.map((rock) => rock.opaquePixels).join(', ')));
results.push(check('every rock variant stands at least half a tile tall and goes into the ground near the bottom of its tile', report.rocks.every((rock) => rock.bottomRow - rock.topRow + 1 >= TILE_PIXELS / 2 && rock.bottomRow >= ROCK.frameHeight - 4), report.rocks.map((rock) => `rows ${rock.topRow}-${rock.bottomRow}`).join(', ')));
results.push(check('no two rock variants are the same', new Set(rockFrames.map((frame) => frame.signature)).size === ROCK.variantCount));

// ---- Grass ----
results.push(check('the grass sheet has `variantCount` tiles of the declared size side by side', sheets.grass.width === GRASS.tilePixels * GRASS.variantCount && sheets.grass.height === GRASS.tilePixels && GRASS.tilePixels === TILE_PIXELS, `${sheets.grass.width}x${sheets.grass.height}`));
const grassTiles = Array.from({ length: GRASS.variantCount }, (_, variant) => frameOf(sheets.grass, { variant, width: GRASS.tilePixels, height: GRASS.tilePixels }));
const grassColours = new Set(grassTiles.flatMap((tile) => tile.pixels.map((pixel) => pixel.colour)));
results.push(check("every rock variant is sunk into the ground: its lowest row is grass, in colours the grass sheet uses, at least 6 pixels wide", report.rocks.every((rock) => rock.footPixels >= 6 && rock.footColours.every((colour) => grassColours.has(colour))), report.rocks.map((rock) => `${rock.footPixels} px`).join(', ')));
const stoneShares = rockFrames.map((frame) => {
  const aboveTheGrass = frame.pixels.filter((pixel) => pixel.alpha === 255 && !grassColours.has(pixel.colour));
  return { greyShare: aboveTheGrass.filter(isGrey).length / aboveTheGrass.length, greyTones: new Set(aboveTheGrass.filter(isGrey).map((pixel) => pixel.colour)).size };
});
results.push(check('every rock variant is stone above its grass: all grey, in at least 4 tones plus the dark edge', stoneShares.every((stone) => stone.greyShare === 1 && stone.greyTones >= 5), stoneShares.map((stone) => `${Math.round(stone.greyShare * 100)}% in ${stone.greyTones} tones`).join(', ')));
results.push(check('no rock variant has a shadow or anything else translucent under it', report.rocks.every((rock) => rock.translucentPixels === 0)));
results.push(check('every pixel of every grass tile is opaque', grassTiles.every((tile) => tile.pixels.every((pixel) => pixel.alpha === 255))));
const flatPatches = grassTiles.map((tile) => flatPatchesOf(tile, 6));
results.push(check('grass is textured all over: no 6x6 patch of any tile is one flat colour', flatPatches.every((count) => count === 0), `${flatPatches.reduce((sum, count) => sum + count, 0)} flat patches in ${GRASS.variantCount} tiles`));
const baseColour = mostCommon(grassTiles.flatMap((tile) => tile.pixels.map((pixel) => pixel.colour)));
const bladeShares = grassTiles.map((tile) => tile.pixels.filter((pixel) => pixel.colour !== baseColour).length / tile.pixels.length);
results.push(check('grass is sparse: in every tile between a tenth and a third of the pixels are blades, the rest turf', bladeShares.every((share) => share > 0.1 && share < 0.34), `${Math.round(Math.min(...bladeShares) * 100)}%-${Math.round(Math.max(...bladeShares) * 100)}%`));
results.push(check('the blade share is even across tiles, so no tile stands out as lighter or darker', Math.max(...bladeShares) - Math.min(...bladeShares) < 0.15));
const [turfRed, turfGreen, turfBlue] = baseColour.split(',').map(Number);
const furthestFromTurf = Math.max(...grassTiles.flatMap((tile) => tile.pixels.filter(isGreen).map((pixel) => Math.max(Math.abs(pixel.red - turfRed), Math.abs(pixel.green - turfGreen), Math.abs(pixel.blue - turfBlue)))));
results.push(check('grass is calm: no green of any tile is more than 32 of 255 away from the turf in any channel', furthestFromTurf <= 32, `furthest ${furthestFromTurf}`));
results.push(check('every grass tile is green everywhere but in its flower', grassTiles.every((tile) => tile.pixels.filter((pixel) => !isGreen(pixel)).length <= 6)));
const flowerTiles = grassTiles.filter((tile) => tile.pixels.some((pixel) => !isGreen(pixel))).length;
results.push(check('flowers are the exception: on at least one tile and on fewer than one in eight', flowerTiles >= 1 && flowerTiles < GRASS.variantCount / 8, `${flowerTiles} of ${GRASS.variantCount} tiles`));
results.push(check('no two grass tiles are the same', new Set(grassTiles.map((tile) => tile.signature)).size === GRASS.variantCount));
report.grass = { baseColour, bladeShares, flowerTiles, flatPatches, furthestFromTurf };

// ---- Contact sheet ----
writeFileSync(path.join(PROOF, '02-sheets-contact.png'), PNG.sync.write(contactSheet()));
writeProof('02-sheets.json', { ...report, results });
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** One frame of a sheet: its pixels with position, colour and alpha, and a string that is equal only for identical frames. */
function frameOf(sheet, { variant, width, height }) {
  const pixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * sheet.width + variant * width + x) * 4;
      const [red, green, blue, alpha] = sheet.data.subarray(offset, offset + 4);
      pixels.push({ x, y, red, green, blue, alpha, colour: `${red},${green},${blue}` });
    }
  }
  return { width, height, pixels, signature: pixels.map((pixel) => `${pixel.colour},${pixel.alpha}`).join(' ') };
}

/** How many size x size patches of the frame, at every position, hold a single colour. */
function flatPatchesOf(frame, size) {
  let flat = 0;
  for (let top = 0; top + size <= frame.height; top += 1) {
    for (let left = 0; left + size <= frame.width; left += 1) {
      const colours = new Set(frame.pixels.filter((pixel) => pixel.x >= left && pixel.x < left + size && pixel.y >= top && pixel.y < top + size).map((pixel) => pixel.colour));
      if (colours.size === 1) flat += 1;
    }
  }
  return flat;
}

function isGrey({ red, green, blue }) {
  return Math.max(red, green, blue) - Math.min(red, green, blue) <= 24;
}

function isGreen({ red, green, blue }) {
  return green > red && green > blue;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((first, second) => second[1] - first[1])[0][0];
}

/** The committed sheets at 4x: the grass tiles in a row, the rocks on grass, then a field with rocks and trees placed as the client places them. */
function contactSheet() {
  const SCALE = 4;
  const columns = 24;
  const rows = 12;
  const small = new PNG({ width: columns * TILE_PIXELS, height: rows * TILE_PIXELS });
  const draw = (sheet, { sourceX, width, height, x, y }) => {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        const targetX = x + dx;
        const targetY = y + dy;
        if (targetX < 0 || targetY < 0 || targetX >= small.width || targetY >= small.height) continue;
        const source = (dy * sheet.width + sourceX + dx) * 4;
        const target = (targetY * small.width + targetX) * 4;
        const alpha = sheet.data[source + 3] / 255;
        for (let channel = 0; channel < 3; channel += 1) small.data[target + channel] = Math.round(sheet.data[source + channel] * alpha + small.data[target + channel] * (1 - alpha));
        small.data[target + 3] = 255;
      }
    }
  };
  // The same hash the client uses (render/tileVariant.ts), so the field below is laid out as in the game.
  const variantOfTile = (column, row, variantCount) => {
    let hash = (Math.imul(column, 374761393) + Math.imul(row, 668265263)) | 0;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) % variantCount;
  };
  const grassAt = (column, row, variant) => draw(sheets.grass, { sourceX: variant * TILE_PIXELS, width: TILE_PIXELS, height: TILE_PIXELS, x: column * TILE_PIXELS, y: row * TILE_PIXELS });
  const standingAt = (sheet, sprite, column, row, variant) => draw(sheet, { sourceX: variant * sprite.frameWidth, width: sprite.frameWidth, height: sprite.frameHeight, x: column * TILE_PIXELS + TILE_PIXELS / 2 - sprite.frameWidth / 2, y: (row + 1) * TILE_PIXELS - sprite.frameHeight });
  // Row 0: every grass tile of the sheet in order. Rows 1-2: grass, with each rock variant on it.
  for (let column = 0; column < columns; column += 1) grassAt(column, 0, column % GRASS.variantCount);
  for (let row = 1; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) grassAt(column, row, variantOfTile(column, row, GRASS.variantCount));
  }
  for (let variant = 0; variant < ROCK.variantCount; variant += 1) standingAt(sheets.rock, ROCK, 2 + variant * 3, 2, variant);
  // Rows 4-11: a field.
  const rocks = [[3, 6], [4, 6], [9, 5], [14, 8], [15, 8], [19, 6], [7, 10], [21, 10]];
  const trees = [[0, 5], [0, 6], [1, 6], [11, 9], [12, 9], [12, 10], [23, 5], [22, 8], [23, 8]];
  const standing = [...rocks.map(([column, row]) => ({ column, row, sheet: sheets.rock, sprite: ROCK })), ...trees.map(([column, row]) => ({ column, row, sheet: sheets.tree, sprite: TREE }))];
  standing.sort((first, second) => first.row - second.row || first.column - second.column);
  for (const { column, row, sheet, sprite } of standing) standingAt(sheet, sprite, column, row, variantOfTile(column, row, sprite.variantCount));
  const big = new PNG({ width: small.width * SCALE, height: small.height * SCALE });
  for (let y = 0; y < big.height; y += 1) {
    for (let x = 0; x < big.width; x += 1) {
      const source = (Math.floor(y / SCALE) * small.width + Math.floor(x / SCALE)) * 4;
      small.data.copy(big.data, (y * big.width + x) * 4, source, source + 4);
    }
  }
  return big;
}
