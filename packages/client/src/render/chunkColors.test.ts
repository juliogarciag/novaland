import { CHUNK_SIZE, generatedWorldMap, getTileDef, readMapTiles, worldMap } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { chunkColorBytes } from './chunkColors';

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

// ---- Helpers ----

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
