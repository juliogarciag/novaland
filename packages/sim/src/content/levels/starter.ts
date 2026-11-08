import { borderWalls } from './helpers';
import type { LevelData } from './types';

/**
 * The first level: a walled field bigger than any screen, so the camera has
 * to travel, with a few obstacles to walk around. The columns straight north
 * and east of the spawn stay clear up to the border.
 */
export const starterLevel: LevelData = {
  name: 'starter',
  width: 64,
  height: 40,
  spawn: { x: 0, y: 0 },
  walls: [
    ...borderWalls(64, 40, 1),
    { x: -6, y: -3, width: 3, height: 1 },
    { x: 6, y: 3, width: 1, height: 4 },
    { x: 3, y: -4, width: 2, height: 2 },
    { x: -20, y: -12, width: 6, height: 1 },
    { x: -8, y: -15, width: 4, height: 1 },
    { x: 22, y: -8, width: 1, height: 8 },
    { x: -16, y: 10, width: 2, height: 2 },
    { x: 18, y: 14, width: 8, height: 1 },
    { x: -26, y: 4, width: 1, height: 6 },
  ],
};
