import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * North-east of the clearing: open ground strewn with rocks. A trail runs
 * south from it to the east glade.
 *
 * 45x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs
 * and edited by hand since: change the rows here, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const rockField: AreaData = {
  name: 'rock-field',
  origin: { column: 40, row: -31 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTo..o....TTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTo.............TTT....TTTTTTTTTTT',
    'TTTTTTTTTTTT........o.....o.........TTTTTTTTT',
    'TTTTTTTTTTT.......o.............o...TTTTTTTTT',
    'TT......TT....................o...o..TTTTTTTT',
    '.........T.........T...............oo..TTTTTT',
    '...TTT.....T..........o..........oTo...TTTTTT',
    '.TTTTTT...........o......o...o.o......TTTTTTT',
    '.TTTTTo......o....o.......oo.........TTTTTTTT',
    'TTTTTT.....o.........................TTTTTTTT',
    'TTTTTT......................o........TTTTTTTT',
    'TTTTTT...........o....o....T.........TTTTTTTT',
    'TTTTTTT...o...........................TTTTTTT',
    'TTTTTTT........o........o............TTTTTTTT',
    'TTTTTTTT.......oo....o.......o......TTTTTTTTT',
    'TTTTTTTTTT.....o..o....o......o...TTTTTTTTTTT',
    'TTTTTTTTTTTT.....................TTTTTTTTTTTT',
    'TTTTTTTTTTTTTT.......o.....o..o.TTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT.........o....TTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTT.......TT...TTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTT........TTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.......TTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT....TTTTTT',
  ],
};
