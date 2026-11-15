import { CHUNK_SIZE, getTileDef, NO_TILE, TILE_SIZE, type MapChunk } from '@novaland/sim';
import { chunkRangeAround, chunkRangeWithin, type ChunkRange } from '../render/chunkRange';
import { toPixels } from '../render/units';

/** A painted chunk is kept until the minimap's square is this many tiles away from it, so pacing over a chunk edge paints nothing twice (the terrain renderer's rule). */
const MINIMAP_KEEP_MARGIN_TILES = CHUNK_SIZE / 2;

/**
 * A chunk as the minimap paints it: one pixel per tile, row by row, as RGBA
 * bytes. Every tile is the colour of its def, whatever kind it is, so water,
 * paths and any tile added later appear with no change here. Where no area
 * put a tile the pixel is transparent.
 */
export function chunkColorBytes(chunk: MapChunk): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE * 4);
  const colorByDefId = new Map<number, number>();
  chunk.defIds.forEach((defId, index) => {
    if (defId === NO_TILE) return;
    let color = colorByDefId.get(defId);
    if (color === undefined) {
      color = getTileDef(defId).color;
      colorByDefId.set(defId, color);
    }
    pixels[index * 4] = (color >> 16) & 0xff;
    pixels[index * 4 + 1] = (color >> 8) & 0xff;
    pixels[index * 4 + 2] = color & 0xff;
    pixels[index * 4 + 3] = 0xff;
  });
  return pixels;
}

/**
 * The chunks a minimap centred on `centre` (metres) and `tilesAcross` tiles wide needs: `draw` holds a tile it
 * shows, `keep` is how far a painted chunk may fall behind before it is dropped. Both lie inside `chunksOfMap`,
 * so however far away or large the centre is, their size depends on the minimap alone.
 */
export function minimapChunkRanges({ centre, tilesAcross, chunksOfMap }: { centre: { readonly x: number; readonly y: number }; tilesAcross: number; chunksOfMap: ChunkRange }): { draw: ChunkRange; keep: ChunkRange } {
  // `chunkRangeAround` takes what a camera shows, in world pixels.
  const side = toPixels(tilesAcross * TILE_SIZE);
  const shown = { x: toPixels(centre.x) - side / 2, y: toPixels(centre.y) - side / 2, width: side, height: side };
  return { draw: chunkRangeWithin(chunkRangeAround(shown, 0), chunksOfMap), keep: chunkRangeWithin(chunkRangeAround(shown, MINIMAP_KEEP_MARGIN_TILES), chunksOfMap) };
}
