import { CHUNK_SIZE } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { chunkCoordinatesIn, chunkRangeAround, DRAW_MARGIN_TILES, isInChunkRange, KEEP_MARGIN_TILES, sameChunkRange } from './chunkRange';
import { PIXELS_PER_METRE } from './units';

const CHUNK_PIXELS = CHUNK_SIZE * PIXELS_PER_METRE;

describe('chunkRangeAround', () => {
  it('is the one chunk a small view sits inside, with no margin', () => {
    expect(chunkRangeAround({ x: 10, y: 10, width: 100, height: 100 }, 0)).toEqual({ firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 });
    expect(chunkRangeAround({ x: -CHUNK_PIXELS + 10, y: 3 * CHUNK_PIXELS + 10, width: 100, height: 100 }, 0)).toEqual({ firstColumn: -1, lastColumn: -1, firstRow: 3, lastRow: 3 });
  });

  it('takes in every chunk the view touches', () => {
    const view = { x: CHUNK_PIXELS - 1, y: -1, width: CHUNK_PIXELS + 2, height: 2 };
    expect(chunkRangeAround(view, 0)).toEqual({ firstColumn: 0, lastColumn: 2, firstRow: -1, lastRow: 0 });
  });

  it('reaches a margin of tiles further on every side', () => {
    // A view one tile inside chunk (0, 0) on every side: a margin of two tiles reaches all eight neighbours.
    const inset = PIXELS_PER_METRE;
    const view = { x: inset, y: inset, width: CHUNK_PIXELS - 2 * inset, height: CHUNK_PIXELS - 2 * inset };
    expect(chunkRangeAround(view, 0)).toEqual({ firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 });
    expect(chunkRangeAround(view, 2)).toEqual({ firstColumn: -1, lastColumn: 1, firstRow: -1, lastRow: 1 });
  });

  it('does not depend on how big the world is: a screen of 60 by 34 tiles never needs more than nine chunks drawn', () => {
    const view = { x: 123456, y: -98765, width: 60 * PIXELS_PER_METRE, height: 34 * PIXELS_PER_METRE };
    const drawn = chunkCoordinatesIn(chunkRangeAround(view, DRAW_MARGIN_TILES));
    expect(drawn.length).toBeLessThanOrEqual(Math.ceil((60 + 2 * DRAW_MARGIN_TILES) / CHUNK_SIZE + 1) * Math.ceil((34 + 2 * DRAW_MARGIN_TILES) / CHUNK_SIZE + 1));
    expect(drawn.length).toBeLessThanOrEqual(9);
  });

  it('keeps chunks further out than it draws them, so a chunk edge is not a place where chunks flicker', () => {
    expect(KEEP_MARGIN_TILES).toBeGreaterThan(DRAW_MARGIN_TILES);
    const view = { x: 0, y: 0, width: 320, height: 240 };
    const draw = chunkRangeAround(view, DRAW_MARGIN_TILES);
    const keep = chunkRangeAround(view, KEEP_MARGIN_TILES);
    for (const coordinate of chunkCoordinatesIn(draw)) expect(isInChunkRange(keep, coordinate)).toBe(true);
  });
});

describe('chunk ranges', () => {
  it('lists coordinates top row first, left to right, and knows what is inside', () => {
    const range = { firstColumn: -1, lastColumn: 0, firstRow: 2, lastRow: 3 };
    expect(chunkCoordinatesIn(range)).toEqual([
      { column: -1, row: 2 },
      { column: 0, row: 2 },
      { column: -1, row: 3 },
      { column: 0, row: 3 },
    ]);
    expect(isInChunkRange(range, { column: 0, row: 3 })).toBe(true);
    expect(isInChunkRange(range, { column: 1, row: 3 })).toBe(false);
    expect(isInChunkRange(range, { column: -1, row: 1 })).toBe(false);
    expect(sameChunkRange(range, { ...range })).toBe(true);
    expect(sameChunkRange(range, { ...range, lastRow: 4 })).toBe(false);
  });
});
