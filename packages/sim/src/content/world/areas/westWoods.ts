import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * West of the clearing, through its west exit: thin woods, trees standing
 * apart with grass between them. Trails leave north to the old grove and
 * south to the stone hollow.
 *
 * A small lake hides in the open ground at its west end. Like every lake it is deep water ringed by shallows.
 *
 * 45x30 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const westWoods: AreaData = {
  name: 'west-woods',
  origin: { column: -45, row: 0 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
    '~': TerrainDefId.Water,
    '-': TerrainDefId.Shallows,
  },
  rows: [
    'TTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTT.....TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTT......TTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTT.....TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT...TT..T.TTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT....T....TTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT............T....TTTTTTTTTTTTT',
    'TTTTTTT...T.TT...................TTTTTTTTTTTT',
    'TTTTTT......T......o...............TTTTTTTTTT',
    'TTTTT...................T...T..T.T..TTTT....T',
    'TTTTTT......TT....T.....T.T.T....T...T.......',
    'TTTT......T..TT...T.....T..........T.....TT..',
    'TTTT...T...-----............T....T........TTT',
    'TTTT....oT--~~~-T.T.......................TTT',
    'TTTTT.....-~~~~--......T.......o...T.....TTTT',
    'TTTTT....T-~~~~~-..........T.....TTT......TTT',
    'TTTTTT....----~--..TT.....TT..............TTT',
    'TTTTTT.T...TT---.....T........T..........TTTT',
    'TTTTTT..T.......T.................T....TTTTTT',
    'TTTTTT.........T....o..T.............T.TTTTTT',
    'TTTTTT....T.......T.......TT..........TTTTTTT',
    'TTTTTTT.....T.................T...TT..TTTTTTT',
    'TTTTTTTTTT..........T.o...............TTTTTTT',
    'TTTTTTTTTTT..o.T.TT......T............TTTTTTT',
    'TTTTTTTTTTTTTT.....T...T.T...TTT.TTTTTTTTTTTT',
    'TTTTTTTTTTTTTT..T....T......TTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTT..........TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT....TTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
};
