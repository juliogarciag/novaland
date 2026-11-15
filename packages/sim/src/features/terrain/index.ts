import { readMapTiles } from '../../content/world/tiles';
import type { Feature } from '../../core/feature';
import { createStaticBoxes } from '../../core/physics';
import { solidRectangles } from './rectangles';

/**
 * The ground and what stands on it. The map's solid tiles (trees, rocks)
 * become static colliders, chunk by chunk in the map's chunk order, merged
 * into rectangles so a forest border is a handful of boxes rather than
 * hundreds.
 *
 * Terrain is not made of entities: it never changes, so it has no
 * components, takes no entity ids and is not part of world state. Every
 * sim, on a server or in a browser's prediction, builds the same colliders
 * from the same map, and a snapshot names the map by its checksum next to
 * the physics world that holds them. The client draws every tile from the
 * same map.
 */
export const terrainFeature: Feature = {
  name: 'terrain',
  init(sim) {
    const tiles = readMapTiles(sim.map);
    for (const chunk of tiles.chunks) {
      const boxes = solidRectangles(chunk).map((rectangle) => {
        const halfWidth = (rectangle.width * tiles.tileSize) / 2;
        const halfHeight = (rectangle.height * tiles.tileSize) / 2;
        return { x: rectangle.column * tiles.tileSize + halfWidth, y: rectangle.row * tiles.tileSize + halfHeight, halfWidth, halfHeight };
      });
      if (boxes.length > 0) createStaticBoxes(sim, boxes);
    }
  },
};
