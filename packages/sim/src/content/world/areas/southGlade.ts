import { TerrainDefId } from '../../../features/terrain/defs';
import type { AreaData } from '../types';

/**
 * South of the clearing, through its south exit: a glade. Trails leave west
 * to the stone hollow and east to the far clearing.
 *
 * A lake lies in the middle, straight ahead of the trail from the clearing. Like every lake it is deep water ringed by shallows.
 *
 * 40x31 tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.
 * To change the land, edit the rows here by hand, not the script. Every
 * grass tile must stay within reach of the spawn (a test checks it).
 */
export const southGlade: AreaData = {
  name: 'south-glade',
  origin: { column: 0, row: 30 },
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    o: TerrainDefId.Rock,
    '~': TerrainDefId.Water,
    '-': TerrainDefId.Shallows,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT..TTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTT...TT..TTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTT.............TTTTTTTTTTTTTT',
    'TTTTTTTTTTTT....------T....TTTTTTTTTTTTT',
    'TTTTTTTTTT....---~~~~--......TTTTTTTTTTT',
    'TTTTTTTT.....--~~~~~~~--......TTTTTTTTTT',
    'TTTTTTT.....--~~~~~~~~~--......TTTTTTTT.',
    'TT...T......-~~~~~~~~~~~-.......TTTTTT..',
    '............--~~~~~~~~---.......TTTTT...',
    '.............---~~~~~~-T........TTTT....',
    '.TTTTTT.......T-~~~----................T',
    'TTTTTTT........-----.........TT.......TT',
    'TTTTTTTTT...................TTTTTTTTTTTT',
    'TTTTTTTTTTT................TTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT.........o..TTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
};
