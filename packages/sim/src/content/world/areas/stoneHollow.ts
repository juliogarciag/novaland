import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * South-west of the clearing: a round hollow with a ring of standing
 * stones in it. Trails leave north to the west woods and east to the south
 * glade.
 *
 * A pond lies inside the ring of stones.
 *
 * 45x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const stoneHollow: AreaData = {
  name: 'stone-hollow',
  origin: { column: -45, row: 30 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
    '~': TerrainDefId.Water,
  },
  rows: [
    'TTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT.......TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT..........TTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTT.............TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT.......o...o.....TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTT......o.......o....TTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT...................TTTTTTTTTTTTTTTT',
    'TTTTTTTTTT....o...~~~...o.....TTTTTTTTTTTTTTT',
    'TTTTTTTTTT.......~~~~~........TTTTTTTTTTTTTT.',
    'TTTTTTTTTT.......~~~~~........TTTTTTTTTTTTT..',
    'TTTTTTTTT.........~~...........TTTTTTTTTTT...',
    'TTTTTTTTT.....o.........o.......TTTTTTTTTT...',
    'TTTTTTTTT....................T....TTTTTT....T',
    'TTTTTTTTT......o.......o....TT......T......TT',
    'TTTTTTTTTT.......o...o......TTTT..........TTT',
    'TTTTTTTTTTTTT..............TTTTTTT....TTTTTTT',
    'TTTTTTTTTTTTTT.............TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT.........TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
};
