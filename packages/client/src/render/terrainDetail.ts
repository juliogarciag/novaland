/**
 * How the ground is drawn. `art` is the tiles' textures and the standing
 * images (trees, rocks), `colors` is one flat colour per tile, the way the
 * minimap paints it.
 */
export type TerrainDetail = 'art' | 'colors';

/**
 * Below this camera zoom the ground is drawn as colours. At half size a tile
 * is 8 texture pixels and its art still reads; at a quarter it is 4 and the
 * texture is noise, while the tiles on screen, each one a quad the art way,
 * are four times as many. Measured on the 896x640 region in a 2880x1800
 * canvas: the art way holds 60 frames a second down to a zoom of 1/2 and
 * drops to 15 at 1/4 and 9 with the whole map on screen (ticket #74).
 */
export const NEAREST_ZOOM_DRAWN_AS_ART = 0.5;

export function terrainDetailAt(cameraZoom: number): TerrainDetail {
  return cameraZoom < NEAREST_ZOOM_DRAWN_AS_ART ? 'colors' : 'art';
}
