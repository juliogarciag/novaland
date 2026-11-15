import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * North of the clearing: a wide meadow. The trail from the clearing's north
 * exit ends here, with a hidden glade off it on the way; others leave west
 * to the old grove and east to the rock field.
 *
 * 40x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const northMeadow: AreaData = {
  name: 'north-meadow',
  origin: { column: 0, row: -31 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT..TTTT..........TT..TTTTTTTTTTTT',
    'TTTTTTT...........T...........TTTTTTTTTT',
    'TTTTTT.........................TTTTTTTTT',
    'TTTTTT..........................TTTTTTTT',
    'TTTTT............................TTTTTTT',
    'TTTTT.............................TTTTT.',
    '...................................TTT..',
    '........................................',
    'TTTT....................................',
    'TTTT..............................TTTTTT',
    'TTTT.............................TTTTTTT',
    'TTTT.......T...................TTTTTTTTT',
    'TTTTT.T......................TTTTTTTTTTT',
    'TTTTTTT...T.................TTTTTTTTTTTT',
    'TTTTTTTTTTTTT..........TTT...TTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTT...TTTT...TTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTT.......TTTTTTTT',
    'TTTTTTT.......TTTTTTTTTT...........TTTTT',
    'TTTTT..........TTTTTTTT....TT.......TTTT',
    'TTTTT..........TTTTTTT....TTTTTTT...TTTT',
    'TTTTT...........TTTTT....TTTTTTTTT...TTT',
    'TTTTTT............T.....TTTTTTTTTTT..TTT',
    'TTTTTTTTT.TTTTT........TTTTTTTTTTT...TTT',
    'TTTTTTTTTTTTTTTT.....TTTTTTTTTTTTT..TTTT',
  ],
};
