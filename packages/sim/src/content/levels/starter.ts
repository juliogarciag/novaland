import { TerrainDefId } from '../../features/terrain/defs';
import type { LevelData } from './types';

/**
 * The first level: a clearing in a forest. Trees ring the whole map with no
 * gap, and a few rocks and tree clumps break up the grass inside. Each
 * character is one tile (one metre); the spawn sits on the grass at the
 * western side of the clearing.
 */
export const starterLevel: LevelData = {
  name: 'starter',
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.TTTTT',
    'TTT.......TT.................T.......TTT',
    'TT.........T.........................TTT',
    'TT....................................TT',
    'TT..o.......................o.........TT',
    'TTT...................................TT',
    'TTT...........................o.......TT',
    'TT....................................TT',
    'TT............TT..........oo..........TT',
    'TT............TT......................TT',
    'TT..o.................................TT',
    'TTT............................o......TT',
    'TT....................................TT',
    'TT....................................TT',
    'TT....................................TT',
    'TTT...........o.......................TT',
    'TT........................TT..........TT',
    'TT........................TT.........TTT',
    'TT....................................TT',
    'TT......................o.............TT',
    'TTT...................................TT',
    'TT....................................TT',
    'TT.o...........................o......TT',
    'TTT..................................TTT',
    'TTTT......TT.................TT.....TTTT',
    'TTTTTT...TTTTT.............TTTTT...TTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  spawn: { column: 6, row: 14 },
};
