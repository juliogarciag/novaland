import type { MinimapMarker } from '../minimap';
import type { TileCoordinate, WorldMap } from './types';

/** A fixed place of the world that views point out, such as the starting point. It is not an entity: nothing about it changes or travels. */
export interface Landmark {
  readonly name: string;
  /** The world tile the place is on; `tileCentre` gives its metres. */
  readonly tile: TileCoordinate;
  /** How the minimap marks it. */
  readonly minimap: MinimapMarker;
}

/** The starting point is the one place a lost player must always be able to find, so its marker stays on the minimap's edge when it is out of range. */
const STARTING_POINT_MARKER: MinimapMarker = { shape: 'diamond', color: 0xffd84a, beyondRange: 'edge' };

/**
 * The landmarks of a map. Today that is the starting point, the tile
 * players appear on. A ticket that adds named places (a town, a cave mouth)
 * lists them here.
 */
export function mapLandmarks(map: WorldMap): readonly Landmark[] {
  return [{ name: 'starting point', tile: map.spawn, minimap: STARTING_POINT_MARKER }];
}
