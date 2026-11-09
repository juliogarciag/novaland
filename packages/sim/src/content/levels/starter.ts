import { TerrainDefId } from '../../features/terrain/defs';
import type { LevelData } from './types';

/**
 * The first level: a clearing in a forest. Trees ring the whole map, dirt
 * paths cross it, and a few rocks and tree clumps break up the grass. Each
 * character is one tile (one metre); the spawn sits on the western path.
 */
export const starterLevel: LevelData = {
  name: 'starter',
  legend: {
    T: TerrainDefId.Tree,
    '.': TerrainDefId.Grass,
    '=': TerrainDefId.Dirt,
    o: TerrainDefId.Rock,
  },
  rows: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTT==TTTTTTTTTTTT.TTTTT',
    'TTT.......TT........==.......T.......TTT',
    'TT.........T........==...............TTT',
    'TT..................==................TT',
    'TT..o...............==......o.........TT',
    'TTT.......==========================..TT',
    'TTT.......==........==........o...==..TT',
    'TT........==........==............==..TT',
    'TT........==..TT....==....oo......==..TT',
    'TT........==..TT....==............==..TT',
    'TT..o.....==........==............==..TT',
    'TTT.......==........==.........o..==..TT',
    'TT====================================TT',
    'TT====================================TT',
    'TT........==........==............==..TT',
    'TTT.......==..o.....==............==..TT',
    'TT........==........==....TT......==..TT',
    'TT........==........==....TT......==.TTT',
    'TT........==........==............==..TT',
    'TT........==........==..o.........==..TT',
    'TTT.......==========================..TT',
    'TT..................==................TT',
    'TT.o................==.........o......TT',
    'TTT.................==...............TTT',
    'TTTT......TT........==.......TT.....TTTT',
    'TTTTTT...TTTTT......==.....TTTTT...TTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  spawn: { column: 6, row: 14 },
};
