import { clearing } from './areas/clearing';
import { eastGlade } from './areas/eastGlade';
import { farClearing } from './areas/farClearing';
import { northMeadow } from './areas/northMeadow';
import { oldGrove } from './areas/oldGrove';
import { rockField } from './areas/rockField';
import { southGlade } from './areas/southGlade';
import { stoneHollow } from './areas/stoneHollow';
import { westWoods } from './areas/westWoods';
import type { AreaData, WorldMap } from './types';

/**
 * Every area of the world. Add an area by writing its file in `areas/` and
 * adding one line here; the coordinates it reserves are its `origin` and the
 * size of its rows, and reading the map fails if two areas overlap.
 */
const areas: readonly AreaData[] = [
  clearing,
  oldGrove,
  northMeadow,
  rockField,
  westWoods,
  eastGlade,
  stoneHollow,
  southGlade,
  farClearing,
];

/**
 * The world: the one map every sim, server and client is built from. There
 * are no other levels; whatever is added to the game is placed in here.
 * The spawn is on the western side of the clearing, and the clearing is in
 * the middle of the land: eight areas surround it, one on each side and
 * corner, and together they are one rectangle of forest with trees all along
 * its edge.
 */
export const worldMap: WorldMap = {
  areas,
  spawn: { column: 6, row: 14 },
};
