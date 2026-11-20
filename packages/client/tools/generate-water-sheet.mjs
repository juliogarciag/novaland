/**
 * Generates the two sheets a lake is drawn from, into public/sprites:
 * water.png, the deep middle, and shallows.png, the ring round it at the
 * coast. The layout of each must match the `groundSprite` of its def in
 * packages/sim/src/features/terrain/defs.ts: WATER_VARIANT_COUNT plain
 * tiles side by side, then one edge tile for every shape in EDGE_SHAPES,
 * each TILE_PIXELS square.
 *
 * A plain tile is still water all over: one blue, with a few short ripples
 * lying flat on it, a lighter one and a darker one by turns down the tile,
 * and now and then a glint. Ripples never touch the edge of a tile, so any
 * two tiles can sit side by side without a seam. The tiles differ only in
 * where the ripples fall, which is what keeps a lake from repeating.
 *
 * An edge tile is a plain tile with the end of the surface drawn inside it,
 * on the sides its shape says the surface ends. For the shallows that is
 * the coast, and the coast is a drop: the water lies below the grass. Where
 * the lake turns a corner the land rounds into the tile. Under the grass is
 * the bank, a wall of earth, seen as the game sees everything, from the
 * south and above: tall on the far shore, where it faces the viewer, thin
 * at the sides, and only the lip of the grass on the near shore, where it
 * faces away. Below the wall the bank's shadow darkens the water. Nothing
 * at the edge is brighter than the water: a bright rim reads as a raised
 * one. For the deep water the edge is only a step of colour towards the
 * shallows around it. It is a placeholder: nothing moves.
 *
 * Plain Node, no dependencies; the pixel canvas and the file writing are shared with the other terrain sheets.
 *
 *   node tools/generate-water-sheet.mjs                # writes public/sprites/water.png and shallows.png
 *   node tools/generate-water-sheet.mjs --out <dir>    # writes them somewhere else (used by verifications)
 */
import { blit, createCanvas, noise, pixel } from './pixelCanvas.mjs';
import { writeSheet, writeSheetWhenRunDirectly } from './sheetFile.mjs';

export const TILE_PIXELS = 32;
export const WATER_VARIANT_COUNT = 8;

/**
 * The eight neighbours of a tile as bits of an edge shape, and every shape
 * there is, in sheet order. The same as `EdgeNeighbour` and `EDGE_SHAPES`
 * of the sim, which this plain script cannot import; the test next to it
 * checks that the two lists are equal.
 */
const NEIGHBOUR = { north: 1, east: 2, south: 4, west: 8, northEast: 16, southEast: 32, southWest: 64, northWest: 128 };
const ALL_NEIGHBOURS = 255;
export const EDGE_SHAPES = [...new Set(Array.from({ length: ALL_NEIGHBOURS + 1 }, (_, neighbours) => edgeShapeOf(neighbours)))]
  .filter((shape) => shape !== ALL_NEIGHBOURS)
  .sort((first, second) => first - second);

/** Where the lake turns a corner, the other side rounds into the tile along a circle of this radius, in pixels. */
const CORNER_RADIUS = 10;

/**
 * The two surfaces. `surface` is the def's `color`: what a view without the
 * sheet fills the tile with. `outside` is what lies past the edge and fills
 * the rounded corners. `edgeColor` says what is painted over a pixel near
 * the edge, or nothing to leave the surface: `distance` is how many pixels
 * from the outside the pixel is, in whole pixels, one for a pixel that touches it, and
 * `outsideToNorth` says where the outside is from there, as a number: 1
 * for straight north, 0 for east or west, -1 for straight south, and the
 * values between round a corner.
 */
export const WATER_SURFACES = {
  water: {
    key: 'water',
    seed: 211,
    colors: { rippleShade: [0x34, 0x72, 0xc0], surface: [0x3e, 0x82, 0xd2], rippleLight: [0x62, 0xa0, 0xe4], glint: [0xa6, 0xcc, 0xf2] },
    // Past deep water are the shallows: the same blue as their sheet below.
    outside: [0x74, 0xb8, 0xea],
    // Two steps of two pixels each.
    edgeColor: ({ distance }) => [[0x5c, 0xa2, 0xe0], [0x4a, 0x90, 0xd8]][Math.ceil(distance / 2) - 1],
  },
  shallows: {
    key: 'shallows',
    seed: 467,
    colors: { rippleShade: [0x62, 0xa8, 0xe0], surface: [0x74, 0xb8, 0xea], rippleLight: [0x9c, 0xd2, 0xf4], glint: [0xdc, 0xf0, 0xfc] },
    // Past the shallows is land: the turf of the grass sheet.
    outside: [0x5c, 0x9e, 0x4a],
    edgeColor: ({ distance, outsideToNorth }) => {
      // The wall is eight pixels tall where it faces the viewer, four at the sides, and two, the lip alone, where it faces away.
      const wallPixels = Math.round(outsideToNorth > 0 ? 4 + 4 * outsideToNorth : 4 + 2 * outsideToNorth);
      // A bank that faces away casts no shadow this side of it.
      const shadowPixels = outsideToNorth < 0 ? 0 : Math.round(2 + 2 * outsideToNorth);
      // The lip: the turf darkens as it curls over the edge.
      if (distance === 1) return BANK_COLORS.turfOverEdge;
      if (distance === LIP_PIXELS) return BANK_COLORS.lip;
      if (distance <= wallPixels - EARTH_FOOT_PIXELS) return BANK_COLORS.earth;
      if (distance <= wallPixels) return BANK_COLORS.earthFoot;
      if (distance <= wallPixels + shadowPixels) return BANK_COLORS.shadowOnWater;
      return undefined;
    },
  },
};

/** How many pixels tall the lip of the turf is, and the darker foot of the earth at the waterline. */
const LIP_PIXELS = 2;
const EARTH_FOOT_PIXELS = 2;

/** The bank of a lake, from the grass down: the turf darkening over the edge and its dark lip, the earth under it, its darker foot at the waterline, and the shallows in the bank's shadow. */
export const BANK_COLORS = {
  turfOverEdge: [0x52, 0x92, 0x44],
  lip: [0x3a, 0x6e, 0x38],
  earth: [0x7a, 0x5c, 0x3a],
  earthFoot: [0x5a, 0x42, 0x2c],
  shadowOnWater: [0x52, 0x94, 0xcc],
};

/**
 * Ripples are dealt out evenly: the tile is cut into bands of this many
 * pixels and every band gets one ripple, somewhere along it. Scattering
 * them freely leaves one tile bare and the next crowded.
 */
const BAND_PIXELS = 8;

/** A ripple is this many pixels long at least and at most, and one pixel tall. */
const SHORTEST_RIPPLE = 6;
const LONGEST_RIPPLE = 10;

/** Ripples keep this many pixels clear of every side of the tile. */
const RIPPLE_MARGIN = 2;

/** The whole sheet of one surface: every variant side by side, then every edge tile. */
export function paintWaterSheet(surface) {
  const sheet = createCanvas(TILE_PIXELS * (WATER_VARIANT_COUNT + EDGE_SHAPES.length), TILE_PIXELS);
  for (let variant = 0; variant < WATER_VARIANT_COUNT; variant += 1) blit(sheet, paintPlainTile(surface, variant), variant * TILE_PIXELS, 0);
  EDGE_SHAPES.forEach((shape, index) => blit(sheet, paintEdgeTile(surface, { shape, variant: index % WATER_VARIANT_COUNT }), (WATER_VARIANT_COUNT + index) * TILE_PIXELS, 0));
  return sheet;
}

function paintPlainTile(surface, variant) {
  const tile = createCanvas(TILE_PIXELS, TILE_PIXELS);
  const seed = surface.seed + variant * 13;
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) pixel(tile, x, y, surface.colors.surface);
  }
  for (let bandTop = 0; bandTop < TILE_PIXELS; bandTop += BAND_PIXELS) paintRipple(tile, { bandTop, seed, colors: surface.colors });
  return tile;
}

/**
 * One ripple in the band that starts at `bandTop`: light or dark by turns
 * down the tile, clear of the tile's edge. A light one is the crest of a
 * swell, with the darker blue under it two pixels shorter at each end, and
 * sometimes a glint on it.
 */
function paintRipple(tile, { bandTop, seed, colors }) {
  const length = SHORTEST_RIPPLE + Math.floor(noise(bandTop, 1, seed) * (LONGEST_RIPPLE - SHORTEST_RIPPLE + 1));
  const left = RIPPLE_MARGIN + Math.floor(noise(bandTop, 2, seed) * (TILE_PIXELS - 2 * RIPPLE_MARGIN - length + 1));
  // Rows 2 to 4 of the band, the swell's second row at most 5: never near the tile's first row or its last.
  const y = bandTop + 2 + Math.floor(noise(bandTop, 3, seed) * 3);
  const isLight = (bandTop / BAND_PIXELS + seed) % 2 === 0;
  const color = isLight ? colors.rippleLight : colors.rippleShade;
  for (let x = left; x < left + length; x += 1) pixel(tile, x, y, color);
  if (!isLight) return;
  for (let x = left + 2; x < left + length - 2; x += 1) pixel(tile, x, y + 1, colors.rippleShade);
  if (noise(bandTop, 4, seed) < 0.5) {
    pixel(tile, left + 2, y, colors.glint);
    pixel(tile, left + 3, y, colors.glint);
  }
}

/** A plain tile with the end of the surface painted over it: the outside where it reaches into the tile, then what the surface says belongs near its edge. */
function paintEdgeTile(surface, { shape, variant }) {
  const tile = paintPlainTile(surface, variant);
  const isOutside = outsideOfShape(shape);
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      if (isOutside(x, y)) {
        pixel(tile, x, y, surface.outside);
        continue;
      }
      const edge = edgeNear(isOutside, x, y);
      if (!edge) continue;
      const color = surface.edgeColor({ distance: Math.round(edge.distance), outsideToNorth: edge.outsideToNorth });
      if (color) pixel(tile, x, y, color);
    }
  }
  return tile;
}

/**
 * Whether a pixel is past the edge, for a tile of this shape. Pixel
 * coordinates are the tile's own, so the eight tiles around it are the
 * pixels below 0 and from TILE_PIXELS up. A neighbour that is not the same
 * surface is outside all over. Inside the tile, the outside comes round
 * the corner between two such neighbours, which is what rounds a lake.
 */
function outsideOfShape(shape) {
  const isSame = (bit) => (shape & bit) !== 0;
  const last = TILE_PIXELS - 1;
  return (x, y) => {
    const column = x < 0 ? -1 : x > last ? 1 : 0;
    const row = y < 0 ? -1 : y > last ? 1 : 0;
    if (column !== 0 || row !== 0) return !isSame(neighbourBit(column, row));
    // Inside the tile: measured from the nearest corner, so one test covers all four.
    const fromWest = x < TILE_PIXELS / 2;
    const fromNorth = y < TILE_PIXELS / 2;
    if (isSame(fromWest ? NEIGHBOUR.west : NEIGHBOUR.east) || isSame(fromNorth ? NEIGHBOUR.north : NEIGHBOUR.south)) return false;
    const acrossFromCorner = (fromWest ? x : last - x) + 0.5;
    const downFromCorner = (fromNorth ? y : last - y) + 0.5;
    if (acrossFromCorner > CORNER_RADIUS || downFromCorner > CORNER_RADIUS) return false;
    return Math.hypot(CORNER_RADIUS - acrossFromCorner, CORNER_RADIUS - downFromCorner) > CORNER_RADIUS;
  };
}

/** The bit of the neighbour one tile across (`column`) and down (`row`), each -1, 0 or 1. A diagonal the shape dropped counts as the surface ending there only when a side beside it does, which `isOutside` of that side already says. */
function neighbourBit(column, row) {
  if (row === -1) return column === -1 ? NEIGHBOUR.northWest : column === 1 ? NEIGHBOUR.northEast : NEIGHBOUR.north;
  if (row === 1) return column === -1 ? NEIGHBOUR.southWest : column === 1 ? NEIGHBOUR.southEast : NEIGHBOUR.south;
  return column === -1 ? NEIGHBOUR.west : NEIGHBOUR.east;
}

/**
 * How far the edge is from this pixel of the surface, in pixels (one for a
 * pixel that touches it by a side, a little more by a corner), and which way
 * it lies, as `outsideToNorth` (see WATER_SURFACES). The way is the average
 * over the outside pixels nearly as near as the nearest, not that one alone:
 * round a corner the nearest pixel jumps between the arc and the straight
 * edge, and the bank would come out speckled. Nothing when the edge is
 * further than any edge is painted.
 */
function edgeNear(isOutside, x, y) {
  const reach = 14;
  const outsidePixels = [];
  for (let otherY = y - reach; otherY <= y + reach; otherY += 1) {
    for (let otherX = x - reach; otherX <= x + reach; otherX += 1) {
      if (isOutside(otherX, otherY)) outsidePixels.push({ across: otherX - x, down: otherY - y, distance: Math.hypot(otherX - x, otherY - y) });
    }
  }
  if (outsidePixels.length === 0) return undefined;
  const distance = Math.min(...outsidePixels.map((outsidePixel) => outsidePixel.distance));
  let across = 0;
  let down = 0;
  for (const outsidePixel of outsidePixels) {
    if (outsidePixel.distance > distance + NEARLY_AS_NEAR) continue;
    across += outsidePixel.across / outsidePixel.distance;
    down += outsidePixel.down / outsidePixel.distance;
  }
  const length = Math.hypot(across, down);
  // Outside pixels on opposite sides cancel out: the edge then lies neither north nor south.
  return { distance, outsideToNorth: length === 0 ? 0 : -down / length };
}

/** Outside pixels this many pixels further than the nearest still count towards which way the edge lies. */
const NEARLY_AS_NEAR = 2;

function edgeShapeOf(neighbours) {
  const has = (bits) => (neighbours & bits) === bits;
  let shape = neighbours & (NEIGHBOUR.north | NEIGHBOUR.east | NEIGHBOUR.south | NEIGHBOUR.west);
  if (has(NEIGHBOUR.north | NEIGHBOUR.east | NEIGHBOUR.northEast)) shape |= NEIGHBOUR.northEast;
  if (has(NEIGHBOUR.south | NEIGHBOUR.east | NEIGHBOUR.southEast)) shape |= NEIGHBOUR.southEast;
  if (has(NEIGHBOUR.south | NEIGHBOUR.west | NEIGHBOUR.southWest)) shape |= NEIGHBOUR.southWest;
  if (has(NEIGHBOUR.north | NEIGHBOUR.west | NEIGHBOUR.northWest)) shape |= NEIGHBOUR.northWest;
  return shape;
}

/** Writes both sheets into `directory` as `water.png` and `shallows.png` and returns the paths. */
export function writeWaterSheets(directory) {
  return Object.values(WATER_SURFACES)
    .map((surface) => writeSheet({ directory, key: surface.key, sheet: paintWaterSheet(surface) }))
    .join(' and ');
}

writeSheetWhenRunDirectly(import.meta.url, writeWaterSheets);
