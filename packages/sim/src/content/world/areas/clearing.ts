import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * The first area of the world: a clearing in a forest. Trees ring it, and a
 * few rocks and tree clumps break up the grass. Each character is one tile
 * (one metre). Its top-left tile is world tile (0, 0): the origin of the
 * world is this area's top-left corner, and stays there whatever is built
 * around it.
 */
export const clearing: AreaData = {
  name: 'clearing',
  origin: { column: 0, row: 0 },
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
};
