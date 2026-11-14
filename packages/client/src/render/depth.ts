import { toPixels } from './units';

/**
 * The draw depth of anything that stands on the ground, from where its foot
 * is: the bottom edge of an entity's body or of a standing tile, in metres.
 * Further south is drawn in front. Entities and standing tiles must both get
 * their depth here, or they stop sorting against each other.
 */
export function depthOfBottomEdge(bottomEdgeMetres: number): number {
  return toPixels(bottomEdgeMetres);
}
