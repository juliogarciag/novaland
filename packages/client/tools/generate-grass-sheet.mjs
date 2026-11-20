/**
 * Generates the grass sheet at public/sprites/grass.png: GRASS_VARIANT_COUNT
 * tiles side by side, each TILE_PIXELS square. The layout must match the
 * grass's `groundSprite` in packages/sim/src/features/terrain/defs.ts.
 *
 * Every tile is grass all over: small tufts in a slightly darker and a
 * slightly lighter green than the turf, a few with a brighter tip, dealt
 * out evenly and sparsely so that no patch of a tile is bare, any two tiles
 * can sit side by side without a seam and a field reads as one calm lawn. The tiles differ only in where the blades fall, which is what
 * keeps a field from repeating. Two tiles of the sheet also have a flower.
 * The greens sit between the tree canopy's light tones, so the forest still
 * stands out from the ground.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-grass-sheet.mjs                # writes public/sprites/grass.png
 *   node tools/generate-grass-sheet.mjs --out <dir>    # writes it somewhere else (used by verifications)
 */
import { blit, createCanvas, noise, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const GRASS_SPRITE_KEY = 'grass';
export const TILE_PIXELS = 32;
export const GRASS_VARIANT_COUNT = 24;

/** The greens of the ground. Exported so that things standing in the grass (the rock's buried foot) are painted in the same ones. */
export const GRASS_COLORS = {
  turfShade: [0x52, 0x92, 0x44],
  turf: [0x5c, 0x9e, 0x4a],
  bladeLight: [0x68, 0xaa, 0x50],
  bladeTip: [0x78, 0xb8, 0x58],
};

const FLOWER_COLORS = {
  whitePetal: [0xf4, 0xf1, 0xe4],
  pinkPetal: [0xf0, 0xb4, 0xc8],
  centre: [0xe8, 0xb8, 0x3a],
};

/** The tiles of the sheet that carry a flower, by variant: where its centre is in the tile and the colour of its petals. */
const FLOWERS_BY_VARIANT = new Map([
  [5, { x: 18, y: 11, petal: FLOWER_COLORS.whitePetal }],
  [17, { x: 8, y: 21, petal: FLOWER_COLORS.pinkPetal }],
]);

/**
 * Blades are dealt out evenly: the tile is cut into cells of this many
 * pixels a side and every cell gets one tuft, somewhere in the cell.
 * Scattering them freely over the tile leaves bald patches in one tile and
 * thickets in the next. A tuft is a blade with a shorter one leaning out
 * beside it, sometimes on both sides, in a tone close to the turf: the
 * ground should read as a calm lawn, not as noise.
 */
const CELL_PIXELS = 8;

/** Of every ten tufts, how many are in the lighter green; the rest are in the darker one. */
const LIGHT_TUFTS_IN_TEN = 5;

/** No square of turf this many pixels a side is left without a blade. */
const LARGEST_BARE_PATCH = 12;

/** The whole sheet: every variant side by side. */
export function paintGrassSheet() {
  const sheet = createCanvas(TILE_PIXELS * GRASS_VARIANT_COUNT, TILE_PIXELS);
  for (let variant = 0; variant < GRASS_VARIANT_COUNT; variant += 1) blit(sheet, paintGrassTile(variant), variant * TILE_PIXELS, 0);
  return sheet;
}

function paintGrassTile(variant) {
  const tile = createCanvas(TILE_PIXELS, TILE_PIXELS);
  const seed = 101 + variant * 7;
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) pixel(tile, x, y, GRASS_COLORS.turf);
  }
  forEachTuftFoot(seed, (x, y) => paintTuft(tile, { x, y, seed }));
  coverBarePatches(tile, seed);
  const flower = FLOWERS_BY_VARIANT.get(variant);
  if (flower) paintFlower(tile, flower);
  return tile;
}

/** Calls `paint(x, y)` for the pixel each tuft of this tile grows from: two in every cell, one in its upper half and one in its lower. */
function forEachTuftFoot(seed, paint) {
  const halfCell = CELL_PIXELS / 2;
  for (let cellY = 0; cellY < TILE_PIXELS; cellY += CELL_PIXELS) {
    for (let cellX = 0; cellX < TILE_PIXELS; cellX += CELL_PIXELS) {
      for (const halfTop of [cellY, cellY + halfCell]) {
        const x = cellX + Math.floor(noise(cellX, halfTop, seed) * CELL_PIXELS);
        const y = halfTop + Math.floor(noise(cellX, halfTop, seed + 50) * halfCell);
        paint(x, y);
      }
    }
  }
}

/**
 * A blade three to five pixels tall, light or dark, with a shorter one
 * standing beside it, and in a tuft in three a third on the other side; a
 * light one sometimes has a bright tip. Now and then the short blade bends
 * out at the top, which keeps a field from reading as a comb.
 */
function paintTuft(tile, { x, y, seed }) {
  const isLight = noise(x, y, seed + 1) * 10 < LIGHT_TUFTS_IN_TEN;
  const color = isLight ? GRASS_COLORS.bladeLight : GRASS_COLORS.turfShade;
  const height = 3 + Math.floor(noise(x, y, seed + 6) * 3);
  paintBlade(tile, { x, y, height, color });
  if (isLight && noise(x, y, seed + 2) < 0.2 && y - height >= 0) paintBlade(tile, { x, y: y - height, height: 1, color: GRASS_COLORS.bladeTip });
  const side = noise(x, y, seed + 7) < 0.5 ? -1 : 1;
  paintSideBlade(tile, { x: x + side, y, height: height - 1 - Math.floor(noise(x, y, seed + 8) * 2), color, bendsOut: noise(x, y, seed + 9) < 0.3 ? side : 0 });
  if (noise(x, y, seed + 3) < 0.33) paintSideBlade(tile, { x: x - side, y, height: 2, color, bendsOut: 0 });
}

/** A shorter blade beside a tuft's middle one, its top pixel one column further out when it `bendsOut` (-1 or 1). What would leave the tile is left out. */
function paintSideBlade(tile, { x, y, height, color, bendsOut }) {
  if (x < 0 || x >= TILE_PIXELS) return;
  paintBlade(tile, { x, y, height: height - (bendsOut ? 1 : 0), color });
  const tipX = x + bendsOut;
  const tipY = y - height + 1;
  if (bendsOut && tipX >= 0 && tipX < TILE_PIXELS && tipY >= 0) pixel(tile, tipX, tipY, color);
}

/** Wherever a square of plain turf is left between the blades, grows one more light blade in it, until there is none. */
function coverBarePatches(tile, seed) {
  for (let top = 0; top + LARGEST_BARE_PATCH <= TILE_PIXELS; top += 1) {
    for (let left = 0; left + LARGEST_BARE_PATCH <= TILE_PIXELS; left += 1) {
      if (!isPlainTurf(tile, { left, top, size: LARGEST_BARE_PATCH })) continue;
      const x = left + Math.floor(noise(left, top, seed + 4) * LARGEST_BARE_PATCH);
      const y = top + 2 + Math.floor(noise(left, top, seed + 5) * (LARGEST_BARE_PATCH - 2));
      paintBlade(tile, { x, y, height: 3, color: GRASS_COLORS.bladeLight });
    }
  }
}

function isPlainTurf(tile, { left, top, size }) {
  for (let y = top; y < top + size; y += 1) {
    for (let x = left; x < left + size; x += 1) {
      const offset = (y * tile.width + x) * 4;
      if (tile.data[offset] !== GRASS_COLORS.turf[0] || tile.data[offset + 1] !== GRASS_COLORS.turf[1] || tile.data[offset + 2] !== GRASS_COLORS.turf[2]) return false;
    }
  }
  return true;
}

/** A blade one pixel wide growing up from (x, y). What would leave the tile at the top is left out, so tiles need no particular neighbour. */
function paintBlade(tile, { x, y, height, color }) {
  for (let step = 0; step < height; step += 1) {
    if (y - step >= 0) pixel(tile, x, y - step, color);
  }
}

/** A centre of four pixels with a petal on each side, on a stem with a leaf. */
function paintFlower(tile, { x, y, petal }) {
  for (const [stemX, stemY] of [[x, y + 3], [x, y + 4], [x + 1, y + 5], [x - 1, y + 4]]) pixel(tile, stemX, stemY, GRASS_COLORS.turfShade);
  const petals = [
    [x, y - 2], [x + 1, y - 2], [x, y - 1], [x + 1, y - 1],
    [x - 2, y], [x - 1, y], [x - 2, y + 1], [x - 1, y + 1],
    [x + 2, y], [x + 3, y], [x + 2, y + 1], [x + 3, y + 1],
    [x, y + 2], [x + 1, y + 2],
  ];
  for (const [petalX, petalY] of petals) pixel(tile, petalX, petalY, petal);
  for (const [centreX, centreY] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) pixel(tile, centreX, centreY, FLOWER_COLORS.centre);
}

/** Writes the grass sheet into `directory` as `grass.png` and returns the path. */
export function writeGrassSheet(directory) {
  return writeSheet({ directory, key: GRASS_SPRITE_KEY, sheet: paintGrassSheet() });
}

writeSheetWhenRunDirectly(import.meta.url, writeGrassSheet);
