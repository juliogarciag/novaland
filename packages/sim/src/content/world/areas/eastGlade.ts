import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * East of the clearing, through its east exit: a long glade, with a small
 * one north-east of it on the trail down from the rock field. A trail
 * leaves south to the far clearing, past a glade at its side.
 *
 * A lake lies in its west half, just north of where the trail comes in. Like every lake it is deep water ringed by shallows.
 *
 * 45x30 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const eastGlade: AreaData = {
  name: 'east-glade',
  origin: { column: 40, row: 0 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
    '~': TerrainDefId.Water,
    '-': TerrainDefId.Shallows,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT..TTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT....TTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT......TTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT........TTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT........TTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT........TTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT......TTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.....TTTTTT',
    'TTTTTTTTTTTTTTTT.T......TT..o.TTTT....TTTTTTT',
    'TTTTTTTTTTTTTT.................o.T...TTTTTTTT',
    'TTTTTTTTTTTT-----.......T...........TTTTTTTTT',
    'TTTTTTTT...--~~~---.o.........o......TTTTTTTT',
    'TTTTTTT...--~~~~~~--.................TTTTTTTT',
    'TTTTTTT..--~~~~~~~~--........T........TTTTTTT',
    'TTTTTTT..-~~~~~~~~~~-.T..............TTTTTTTT',
    'TTTTTTT..--~~~~~~~~--...............TTTTTTTTT',
    'TTTTTTTT..--~~~~~~--..............TTTTTTTTTTT',
    'TTTTTTTTT..---~~~--......T.......TTTTTTTTTTTT',
    'TTTTTTTTTT...-----.............TTTTTTTTTTTTTT',
    'TTTTTTTTTT....................TTTTTTTTTTTTTTT',
    'TTTTTTTTT...TTTTTTT......T...TTTTTTTTTTTTTTTT',
    '....TTT.....TTTTTTTT....TTTTTTTTTTTTTTTTTTTTT',
    '..........TTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTT',
    'TT......TTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTT',
    'TTTT.......oTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTT..........T.......TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTT....To............TTTTTTTTTTTTTTTTTTTTTTTT',
    'TTT.............T.....TTTTTTTTTTTTTTTTTTTTTTT',
    'TTT...........TTTTT....TTTTTTTTTTTTTTTTTTTTTT',
    'TTT.........TTTTTTTT....TTTTTTTTTTTTTTTTTTTTT',
  ],
};
