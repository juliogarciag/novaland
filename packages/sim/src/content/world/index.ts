import { clearing } from './areas/clearing';
import type { AreaData, WorldMap } from './types';

/**
 * Every area of the world. Add an area by writing its file in `areas/` and
 * adding one line here; the coordinates it reserves are its `origin` and the
 * size of its rows, and reading the map fails if two areas overlap.
 */
const areas: readonly AreaData[] = [clearing];

/**
 * The world: the one map every sim, server and client is built from. There
 * are no other levels; whatever is added to the game is placed in here.
 * The spawn is on the western side of the clearing.
 */
export const worldMap: WorldMap = {
  areas,
  spawn: { column: 6, row: 14 },
};
