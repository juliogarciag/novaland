import { EDGE_SHAPES as SIM_EDGE_SHAPES, EdgeNeighbour, terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { BANK_COLORS, EDGE_SHAPES, TILE_PIXELS, WATER_SURFACES, WATER_VARIANT_COUNT, paintWaterSheet } from './generate-water-sheet.mjs';

describe('water sheet generator', () => {
  it('knows the same edge shapes, in the same order, as the sim: an edge tile is found by its place in that list', () => {
    expect(EDGE_SHAPES).toEqual(SIM_EDGE_SHAPES);
    expect(EDGE_SHAPES).toHaveLength(46);
  });

  it.each(Object.values(WATER_SURFACES))('paints the $key sheet under the key and in the tile layout its def declares: the variants, then one tile per edge shape', (surface) => {
    const groundSprite = terrainDefs.find((def) => def.name === surface.key)?.groundSprite;
    expect(groundSprite).toMatchObject({ key: surface.key, tilePixels: TILE_PIXELS, variantCount: WATER_VARIANT_COUNT });
    expect(groundSprite?.edgeTiles).toBeDefined();
    const sheet = paintWaterSheet(surface);
    expect([sheet.width, sheet.height]).toEqual([TILE_PIXELS * (WATER_VARIANT_COUNT + EDGE_SHAPES.length), TILE_PIXELS]);
  });

  it.each(Object.values(WATER_SURFACES))('paints the same $key sheet every time', (surface) => {
    expect(paintWaterSheet(surface).data).toEqual(paintWaterSheet(surface).data);
  });

  it.each(Object.values(WATER_SURFACES))('covers every pixel of the $key sheet: water has no holes', (surface) => {
    const { data } = paintWaterSheet(surface);
    for (let offset = 3; offset < data.length; offset += 4) expect(data[offset]).toBe(255);
  });

  it.each(Object.values(WATER_SURFACES))('paints the plain $key tiles mostly in the colour the def falls back to, so a lake looks the same blue with or without the sheet', (surface) => {
    const [red, green, blue] = surface.colors.surface;
    expect(terrainDefs.find((def) => def.name === surface.key)?.color).toBe((red << 16) | (green << 8) | blue);
    const sheet = paintWaterSheet(surface);
    for (let variant = 0; variant < WATER_VARIANT_COUNT; variant += 1) {
      const colours = coloursOfTile(sheet, variant);
      expect(colours.filter((colour) => colour === `${red},${green},${blue}`).length / colours.length).toBeGreaterThan(0.8);
    }
  });

  it.each(Object.values(WATER_SURFACES))('ripples every plain $key tile, paints no two alike, and keeps the edge of every tile plain so tiles join without a seam', (surface) => {
    const sheet = paintWaterSheet(surface);
    const plain = surface.colors.surface.join(',');
    const tiles = Array.from({ length: WATER_VARIANT_COUNT }, (_, variant) => coloursOfTile(sheet, variant));
    for (const tile of tiles) {
      expect(new Set(tile).size).toBeGreaterThanOrEqual(3);
      const edge = tile.filter((_, index) => index % TILE_PIXELS === 0 || index % TILE_PIXELS === TILE_PIXELS - 1 || index < TILE_PIXELS || index >= TILE_PIXELS * (TILE_PIXELS - 1));
      expect(new Set(edge)).toEqual(new Set([plain]));
    }
    expect(new Set(tiles.map((tile) => tile.join(' '))).size).toBe(WATER_VARIANT_COUNT);
  });

  it.each(Object.values(WATER_SURFACES))('draws the edge of a $key tile on the sides where the surface ends, and nowhere else', (surface) => {
    const sheet = paintWaterSheet(surface);
    const firstBand = surface.edgeColor({ distance: 1, outsideToNorth: 0 }).join(',');
    const sides = [
      { bit: EdgeNeighbour.North, pixels: (tile) => tile.slice(0, TILE_PIXELS) },
      { bit: EdgeNeighbour.East, pixels: (tile) => tile.filter((_, index) => index % TILE_PIXELS === TILE_PIXELS - 1) },
      { bit: EdgeNeighbour.South, pixels: (tile) => tile.slice(TILE_PIXELS * (TILE_PIXELS - 1)) },
      { bit: EdgeNeighbour.West, pixels: (tile) => tile.filter((_, index) => index % TILE_PIXELS === 0) },
    ];
    EDGE_SHAPES.forEach((shape, index) => {
      const tile = coloursOfTile(sheet, WATER_VARIANT_COUNT + index);
      for (const side of sides) {
        // The middle of the side: its ends belong to the corners, which the sides beside it shape too.
        const middle = side.pixels(tile).slice(TILE_PIXELS * 0.375, TILE_PIXELS * 0.625);
        const endsHere = (shape & side.bit) === 0;
        expect(middle.every((colour) => colour === firstBand), `shape ${shape}, side ${side.bit}`).toBe(endsHere);
      }
    });
  });

  it.each(Object.values(WATER_SURFACES))('rounds the $key where the surface ends on two sides that meet: the corner of the tile is what lies outside', (surface) => {
    const sheet = paintWaterSheet(surface);
    const outside = surface.outside.join(',');
    const corners = [
      { bits: EdgeNeighbour.North | EdgeNeighbour.West, index: 0 },
      { bits: EdgeNeighbour.North | EdgeNeighbour.East, index: TILE_PIXELS - 1 },
      { bits: EdgeNeighbour.South | EdgeNeighbour.West, index: TILE_PIXELS * (TILE_PIXELS - 1) },
      { bits: EdgeNeighbour.South | EdgeNeighbour.East, index: TILE_PIXELS * TILE_PIXELS - 1 },
    ];
    EDGE_SHAPES.forEach((shape, index) => {
      const tile = coloursOfTile(sheet, WATER_VARIANT_COUNT + index);
      for (const corner of corners) expect(tile[corner.index] === outside, `shape ${shape}, corner ${corner.bits}`).toBe((shape & corner.bits) === 0);
    });
  });

  it('sinks the lake into the ground: the bank is tallest on the far shore, thinner at the sides, a lip alone on the near shore, and nothing at the coast is brighter than the water', () => {
    const { shallows } = WATER_SURFACES;
    const sheet = paintWaterSheet(shallows);
    const water = shallows.colors.surface;
    const isWater = (colour) => colour === water.join(',') || Object.values(shallows.colors).some((ripple) => colour === ripple.join(','));
    const isBlue = (colour) => colour.split(',').map(Number)[2] > colour.split(',').map(Number)[0] + 40;
    // The tile with land on one side only, and how many pixels in from that side, down its middle, are bank rather than water.
    const bankPixels = (landSide, pixelsFromThatSide) => {
      const tile = coloursOfTile(sheet, WATER_VARIANT_COUNT + EDGE_SHAPES.indexOf(255 & ~landSide.bits));
      return pixelsFromThatSide(tile).findIndex(isBlue);
    };
    const column = (tile, x) => tile.filter((_, index) => index % TILE_PIXELS === x);
    const row = (tile, y) => tile.slice(y * TILE_PIXELS, (y + 1) * TILE_PIXELS);
    const middle = TILE_PIXELS / 2;
    const north = bankPixels({ bits: EdgeNeighbour.North | EdgeNeighbour.NorthEast | EdgeNeighbour.NorthWest }, (tile) => column(tile, middle));
    const south = bankPixels({ bits: EdgeNeighbour.South | EdgeNeighbour.SouthEast | EdgeNeighbour.SouthWest }, (tile) => column(tile, middle).reverse());
    const west = bankPixels({ bits: EdgeNeighbour.West | EdgeNeighbour.SouthWest | EdgeNeighbour.NorthWest }, (tile) => row(tile, middle));
    const east = bankPixels({ bits: EdgeNeighbour.East | EdgeNeighbour.NorthEast | EdgeNeighbour.SouthEast }, (tile) => row(tile, middle).reverse());
    expect([north, west, east, south]).toEqual([8, 4, 4, 2]);
    const brightness = (colour) => colour.split(',').map(Number).reduce((sum, channel) => sum + channel, 0);
    EDGE_SHAPES.forEach((_, index) => {
      for (const colour of coloursOfTile(sheet, WATER_VARIANT_COUNT + index)) {
        if (!isWater(colour)) expect(brightness(colour), colour).toBeLessThan(brightness(water.join(',')));
      }
    });
  });

  it('draws the bank on every tile where the shallows end, the ones that only touch land at a corner included, and its shadow always against the bank', () => {
    const sheet = paintWaterSheet(WATER_SURFACES.shallows);
    const lip = BANK_COLORS.lip.join(',');
    const shadow = BANK_COLORS.shadowOnWater.join(',');
    const bank = new Set([BANK_COLORS.earth, BANK_COLORS.earthFoot].map((colour) => colour.join(',')));
    EDGE_SHAPES.forEach((shape, index) => {
      const tile = coloursOfTile(sheet, WATER_VARIANT_COUNT + index);
      expect(tile, `shape ${shape}`).toContain(lip);
      tile.forEach((colour, pixelIndex) => {
        if (colour !== shadow) return;
        const [x, y] = [pixelIndex % TILE_PIXELS, Math.floor(pixelIndex / TILE_PIXELS)];
        const beside = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        // At the rim of the tile the bank it lies under may be in the next tile.
        const atTheRim = beside.some(([besideX, besideY]) => besideX < 0 || besideY < 0 || besideX >= TILE_PIXELS || besideY >= TILE_PIXELS);
        const againstBank = beside.some(([besideX, besideY]) => bank.has(tile[besideY * TILE_PIXELS + besideX]) || tile[besideY * TILE_PIXELS + besideX] === shadow);
        expect(atTheRim || againstBank, `shape ${shape}, shadow at (${x}, ${y})`).toBe(true);
      });
    });
  });

  it('paints the shallows around deep water in the blue of the shallows, so the two sheets meet without a line', () => {
    expect(WATER_SURFACES.water.outside).toEqual(WATER_SURFACES.shallows.colors.surface);
  });
});

// ---- Helpers ----

/** The colour of every pixel of one tile of the sheet, as `r,g,b` strings, row by row. */
function coloursOfTile(sheet, tileIndex) {
  const colours = [];
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      const offset = (y * sheet.width + tileIndex * TILE_PIXELS + x) * 4;
      colours.push(`${sheet.data[offset]},${sheet.data[offset + 1]},${sheet.data[offset + 2]}`);
    }
  }
  return colours;
}
