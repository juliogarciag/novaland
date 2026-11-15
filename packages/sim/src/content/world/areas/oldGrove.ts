import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * North-west of the clearing: thick forest with three small glades in it,
 * joined by trails. The trail south leads to the west woods, the one east to
 * the north meadow.
 *
 * 45x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs
 * and edited by hand since: change the rows here, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const oldGrove: AreaData = {
  name: 'old-grove',
  origin: { column: -45, row: -31 },
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
    'TTTTTTTTTTTT.....TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTT......T...TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT............TTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT.........o..TTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT...........TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT.........o.TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT....o..o...TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTT.............TTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTT.............TTTTTTTTTTTTTTTTT...',
    'TTTTTTTTTTTTT.....TTTT....TTTTTTTTTTTTTTT....',
    'TTTTTTTTTTTTTTTTTTTTTTTT.....TTTTTTTTTTT....T',
    'TTTTTTTTTTTTTTTTTTTTTTTT......o.TTTTTTT....TT',
    'TTTTTTTTTTTTTTTTTTTTTTTT.........TTTTTT...TTT',
    'TTTTTTTTT....TTTT......T..........TTTT...TTTT',
    'TTTTTTT........T..................TTT...TTTTT',
    'TTTTTT.............TT...................TTTTT',
    'TTTTTT...........TTTTTT................TTTTTT',
    'TTTTTT..........TTTTTTTTT.......TTTTTTTTTTTTT',
    'TTTTTT.........TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTT.........TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT......TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
};
