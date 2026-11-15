import { CHUNK_SIZE, generatedWorldMap, getTileDef, readMapTiles, terrainDefs, TILE_SIZE, worldMap, type MapChunk } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { chunkRangeAround, chunkRangeOfTiles, chunkRangeWithin, chunkCoordinatesIn } from '../render/chunkRange';
import { PIXELS_PER_METRE } from '../render/units';
import { MINIMAP_TILES_ACROSS } from './minimapPlacement';
import { chunkPixels, MINIMAP_KEEP_MARGIN_TILES, worldPixelsShown } from './minimapTerrain';

describe('chunkPixels', () => {
  it('paints every tile of the world in the colour of its def, a pixel per tile, and leaves the rest transparent', () => {
    for (const chunk of readMapTiles(worldMap).chunks) {
      const pixels = chunkPixels(chunk);
      expect(pixels).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * 4);
      chunk.defIds.forEach((defId, index) => {
        const expected = defId === 0 ? [0, 0, 0, 0] : [...rgbOf(getTileDef(defId).color), 255];
        expect([...pixels.slice(index * 4, index * 4 + 4)], `chunk ${chunk.column},${chunk.row} tile ${index}`).toEqual(expected);
      });
    }
  });

  it('shows the kinds of tile the world has in different colours, so they can be told apart', () => {
    const colors = terrainDefs.map((def) => def.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('paints a kind of tile it has never heard of from its def alone: water needs no change here', () => {
    const waterDefId = 299;
    const chunk: MapChunk = { column: 0, row: 0, firstTile: { column: 0, row: 0 }, defIds: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(waterDefId) };
    const pixels = chunkPixels(chunk, (defId) => (defId === waterDefId ? 0x3b82f6 : 0));
    expect([...pixels.slice(0, 4)]).toEqual([0x3b, 0x82, 0xf6, 255]);
    expect([...pixels.slice(-4)]).toEqual([0x3b, 0x82, 0xf6, 255]);
  });
});

describe('what the minimap keeps painted', () => {
  it('is the square of tiles around its centre, in world pixels', () => {
    const side = MINIMAP_TILES_ACROSS * TILE_SIZE * PIXELS_PER_METRE;
    expect(worldPixelsShown({ x: 100, y: -20 }, MINIMAP_TILES_ACROSS)).toEqual({ x: 100 * PIXELS_PER_METRE - side / 2, y: -20 * PIXELS_PER_METRE - side / 2, width: side, height: side });
  });

  it('does not depend on how big the world is: at most sixteen chunks shown and twenty-five kept, on the world and on a map a hundred times its size', () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 400, rows: 300 })]) {
      const { bounds, chunks } = readMapTiles(map);
      const chunksOfMap = chunkRangeOfTiles(bounds);
      let mostShown = 0;
      let mostKept = 0;
      // Every place a player could stand, a tile and a bit apart so chunk edges are met at every offset.
      for (let y = bounds.row; y < bounds.row + bounds.height; y += 7.3) {
        for (let x = bounds.column; x < bounds.column + bounds.width; x += 7.3) {
          const shown = worldPixelsShown({ x: x * TILE_SIZE, y: y * TILE_SIZE }, MINIMAP_TILES_ACROSS);
          mostShown = Math.max(mostShown, chunkCoordinatesIn(chunkRangeWithin(chunkRangeAround(shown, 0), chunksOfMap)).length);
          mostKept = Math.max(mostKept, chunkCoordinatesIn(chunkRangeWithin(chunkRangeAround(shown, MINIMAP_KEEP_MARGIN_TILES), chunksOfMap)).length);
        }
      }
      expect(mostShown, `${chunks.length} chunks in the map`).toBeLessThanOrEqual(16);
      expect(mostKept, `${chunks.length} chunks in the map`).toBeLessThanOrEqual(25);
    }
  });
});

// ---- Helpers ----

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
