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
    { x: -6, y: -3, w: 3, h: 1 },
    { x: 6, y: 3, w: 1, h: 4 },
    { x: 3, y: -4, w: 2, h: 2 },
  ],
};
