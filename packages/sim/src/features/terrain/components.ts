import { defineComponent, u32 } from '../../core/components';

/**
 * A static collider covering a rectangle of solid tiles. Terrain colliders
 * carry no DefRef on purpose: the client draws the tile grid itself, so
 * getRenderables skips them. The rectangle is in tile units.
 */
export const TerrainCollider = defineComponent('TerrainCollider', (capacity) => ({
  column: u32(capacity),
  row: u32(capacity),
  /** Width in tiles. */
  width: u32(capacity),
  /** Height in tiles. */
  height: u32(capacity),
}));
