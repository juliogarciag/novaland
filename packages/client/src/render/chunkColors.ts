import { CHUNK_SIZE, getTileDef, NO_TILE, type MapChunk } from '@novaland/sim';

/**
 * A chunk as one pixel per tile, the way the minimap and the far view of the terrain paint it, row by row, as RGBA
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
