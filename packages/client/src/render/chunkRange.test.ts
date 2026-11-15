import { CHUNK_SIZE } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { chunkCoordinatesIn, chunkKey, chunkRangeAround, chunkRangeOfTiles, chunkRangeWithin, chunksToDropAndBuild, DRAW_MARGIN_TILES, isInChunkRange, KEEP_MARGIN_TILES, sameChunkRange } from './chunkRange';
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

  it('does not depend on how big the world is: a screen of 60 by 34 tiles needs at most nine chunks built and keeps at most sixteen', () => {
    const view = { x: 123456, y: -98765, width: 60 * PIXELS_PER_METRE, height: 34 * PIXELS_PER_METRE };
    expect(chunkCoordinatesIn(chunkRangeAround(view, KEEP_MARGIN_TILES)).length).toBeLessThanOrEqual(16);
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

describe('chunksToDropAndBuild', () => {
  const rangeOf = (firstColumn: number, lastColumn: number, firstRow: number, lastRow: number) => ({ firstColumn, lastColumn, firstRow, lastRow });

  it('builds every chunk of the draw range that is not drawn yet, top row first, and drops nothing that is still kept', () => {
    const { drop, build } = chunksToDropAndBuild({ drawnKeys: ['0,0', '-1,0'], draw: rangeOf(0, 1, 0, 1), keep: rangeOf(-1, 2, -1, 2) });
    expect(drop).toEqual([]);
    expect(build).toEqual([{ column: 1, row: 0 }, { column: 0, row: 1 }, { column: 1, row: 1 }]);
  });

  it('drops a drawn chunk only once it is outside the keep range, so stepping back over an edge builds nothing', () => {
    const drawnKeys = ['0,0', '1,0'];
    // The view moved east: chunk 0,0 is out of the draw range but still kept.
    expect(chunksToDropAndBuild({ drawnKeys, draw: rangeOf(1, 1, 0, 0), keep: rangeOf(0, 2, 0, 0) })).toEqual({ drop: [], build: [] });
    // And back west: it is still there, nothing to build.
    expect(chunksToDropAndBuild({ drawnKeys, draw: rangeOf(0, 1, 0, 0), keep: rangeOf(0, 2, 0, 0) })).toEqual({ drop: [], build: [] });
    // Further east it goes.
    expect(chunksToDropAndBuild({ drawnKeys, draw: rangeOf(2, 2, 0, 0), keep: rangeOf(1, 3, 0, 0) })).toEqual({ drop: ['0,0'], build: [{ column: 2, row: 0 }] });
  });

  it('handles negative chunk coordinates and a draw range that holds no chunk', () => {
    expect(chunksToDropAndBuild({ drawnKeys: [chunkKey({ column: -3, row: -2 })], draw: rangeOf(5, 4, 0, 0), keep: rangeOf(-3, -3, -2, -2) })).toEqual({ drop: [], build: [] });
    expect(chunksToDropAndBuild({ drawnKeys: [chunkKey({ column: -3, row: -2 })], draw: rangeOf(5, 4, 0, 0), keep: rangeOf(5, 4, 0, 0) })).toEqual({ drop: ['-3,-2'], build: [] });
  });
});

describe('chunk ranges', () => {
  it('finds the chunks of a rectangle of tiles, negative ones included', () => {
    expect(chunkRangeOfTiles({ column: 0, row: 0, width: 40, height: 30 })).toEqual({ firstColumn: 0, lastColumn: 1, firstRow: 0, lastRow: 0 });
    expect(chunkRangeOfTiles({ column: -1, row: -CHUNK_SIZE, width: 2, height: CHUNK_SIZE })).toEqual({ firstColumn: -1, lastColumn: 0, firstRow: -1, lastRow: -1 });
  });

  it('keeps a range inside a limit however large it is, and holds no chunk when it lies outside', () => {
    const map = chunkRangeOfTiles({ column: 0, row: 0, width: 400, height: 300 });
    const everything = chunkRangeAround({ x: -1e15, y: -1e15, width: 2e15, height: 2e15 }, KEEP_MARGIN_TILES);
    expect(chunkRangeWithin(everything, map)).toEqual(map);
    expect(chunkCoordinatesIn(chunkRangeWithin(everything, map))).toHaveLength(13 * 10);
    const farAway = chunkRangeAround({ x: 1e12, y: 1e12, width: 960, height: 720 }, KEEP_MARGIN_TILES);
    expect(chunkCoordinatesIn(chunkRangeWithin(farAway, map))).toEqual([]);
    expect(isInChunkRange(chunkRangeWithin(farAway, map), { column: 12, row: 9 })).toBe(false);
  });

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
