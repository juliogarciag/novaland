import { borderWalls } from './helpers';
import type { LevelData } from './types';

/** The first, tiny level: a walled room with a few obstacles. */
export const starterLevel: LevelData = {
  name: 'starter',
  width: 24,
  height: 16,
  spawn: { x: 0, y: 0 },
  walls: [
    ...borderWalls(24, 16, 1),
    { x: -6, y: -3, width: 3, height: 1 },
    { x: 6, y: 3, width: 1, height: 4 },
    { x: 3, y: -4, width: 2, height: 2 },
  ],
};
