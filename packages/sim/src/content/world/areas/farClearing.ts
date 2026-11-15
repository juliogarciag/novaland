import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * South-east of the clearing, the furthest place from the spawn: a large
 * clearing with clumps of trees, and a nook in the corner of the world
 * beyond it.
 *
 * A lake lies among its scattered trees, west of the middle. Like every lake it is deep water ringed by shallows.
 *
 * 45x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const farClearing: AreaData = {
  name: 'far-clearing',
  origin: { column: 40, row: 30 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
    '~': TerrainDefId.Water,
    '-': TerrainDefId.Shallows,
  },
  rows: [
    'TTTT.......TTTTTTTTTT....TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTT..TTTT.....oTT...TTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT...................TTTTTTTTTTT',
    'TTTTTTTTTTTTTT.......T...T.........TTTTTTTTTT',
    'T.......TTTTTT...T--------..........TTTTTTTTT',
    '.........TTTT....--~~~~~~-T...T..o....TTTTTTT',
    '...TTT....TTT...--~~~~~~~---...........TTTTTT',
    '.TTTTTT....T..o.-~~~~~~~~~~-..........oTTTTTT',
    'TTTTTTTT........---~~~~~~~--...........TTTTTT',
    'TTTTTTTTT........T-~~~~----T.........T.TTTTTT',
    'TTTTTTTTT.....T...--~~~-T.T......o..TT.TTTTTT',
    'TTTTTTTTT..........-----...............TTTTTT',
    'TTTTTTTTT............T....T............TTTTTT',
    'TTTTTTTTT..............TT..............TTTTTT',
    'TTTTTTTTTT..T..............T..........TTTTTTT',
    'TTTTTTTTTTT..........T.T.............TTTTTTTT',
    'TTTTTTTTTTTTTT....T..................TTTTTTTT',
    'TTTTTTTTTTTTTTTTTT.........TTTTTTTT...T.TTTTT',
    'TTTTTTTTTTTTTTTTTTTT......TTTTTTTTT.......TTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.......TT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.....TTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
};
