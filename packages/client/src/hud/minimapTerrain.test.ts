import { CHUNK_SIZE, generatedWorldMap, getTileDef, readMapTiles, TILE_SIZE, worldMap } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { chunkCoordinatesIn, chunkRangeOfTiles } from '../render/chunkRange';
import { MINIMAP_TILES_ACROSS } from './minimapPlacement';
import { chunkColorBytes, minimapChunkRanges } from './minimapTerrain';

describe('chunkColorBytes', () => {
  it('paints every tile in the colour of its def, a pixel per tile, and leaves the rest transparent: on the world and on a generated map', () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 70, rows: 40 })]) {
      for (const chunk of readMapTiles(map).chunks) {
        const bytes = chunkColorBytes(chunk);
        expect(bytes).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * 4);
        chunk.defIds.forEach((defId, index) => {
          const expected = defId === 0 ? [0, 0, 0, 0] : [...rgbOf(getTileDef(defId).color), 255];
          expect([...bytes.slice(index * 4, index * 4 + 4)], `chunk ${chunk.column},${chunk.row} tile ${index}`).toEqual(expected);
        });
      }
    }
  });
});

describe('minimapChunkRanges', () => {
  it('draws the chunks under the minimap and keeps half a chunk more on every side', () => {
    const chunksOfMap = chunkRangeOfTiles(readMapTiles(generatedWorldMap({ columns: 400, rows: 300 })).bounds);
    // Centred on the corner where four chunks meet, 80 tiles across: 40 tiles each way.
    const centre = { x: 6 * CHUNK_SIZE * TILE_SIZE, y: 4 * CHUNK_SIZE * TILE_SIZE };
    expect(minimapChunkRanges({ centre, tilesAcross: 80, chunksOfMap })).toEqual({
      draw: { firstColumn: 4, lastColumn: 7, firstRow: 2, lastRow: 5 },
      keep: { firstColumn: 4, lastColumn: 7, firstRow: 2, lastRow: 5 },
    });
    expect(minimapChunkRanges({ centre: { x: centre.x + 10, y: centre.y }, tilesAcross: 80, chunksOfMap })).toEqual({
      draw: { firstColumn: 5, lastColumn: 7, firstRow: 2, lastRow: 5 },
      keep: { firstColumn: 4, lastColumn: 8, firstRow: 2, lastRow: 5 },
    });
  });

  it('does not depend on how big the world is: at most sixteen chunks drawn and twenty-five kept, on the world and on a map a hundred times its size', () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 400, rows: 300 })]) {
      const { bounds, chunks } = readMapTiles(map);
      const chunksOfMap = chunkRangeOfTiles(bounds);
      let mostDrawn = 0;
      let mostKept = 0;
      // Every place a player could stand, a few tiles and a bit apart so chunk edges are met at every offset.
      for (let y = bounds.row; y < bounds.row + bounds.height; y += 7.3) {
        for (let x = bounds.column; x < bounds.column + bounds.width; x += 7.3) {
          const { draw, keep } = minimapChunkRanges({ centre: { x: x * TILE_SIZE, y: y * TILE_SIZE }, tilesAcross: MINIMAP_TILES_ACROSS, chunksOfMap });
          mostDrawn = Math.max(mostDrawn, chunkCoordinatesIn(draw).length);
          mostKept = Math.max(mostKept, chunkCoordinatesIn(keep).length);
        }
      }
      expect(mostDrawn, `${chunks.length} chunks in the map`).toBeLessThanOrEqual(16);
      expect(mostKept, `${chunks.length} chunks in the map`).toBeLessThanOrEqual(25);
    }
  });

  it('holds no chunk for a centre far outside the map, however large: positions come from the server', () => {
    const chunksOfMap = chunkRangeOfTiles(readMapTiles(worldMap).bounds);
    for (const far of [1e7, -1e7, 1e300, Number.MAX_VALUE]) {
      const { draw, keep } = minimapChunkRanges({ centre: { x: far, y: far }, tilesAcross: MINIMAP_TILES_ACROSS, chunksOfMap });
      expect(chunkCoordinatesIn(draw), String(far)).toEqual([]);
      expect(chunkCoordinatesIn(keep), String(far)).toEqual([]);
    }
  });
});

// ---- Helpers ----

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
