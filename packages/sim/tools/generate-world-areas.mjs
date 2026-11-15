/**
 * Lays out the land around the clearing and writes it as area files in
 * src/content/world/areas/ (ticket #48). Run with
 * `pnpm --filter @novaland/sim world:areas`.
 *
 * The land is one rectangle of 130x92 tiles with the clearing inside it,
 * about ten times the clearing. It starts as forest. Places (a meadow, a
 * rock field, a ring of stones...) are cleared out of it and trails of grass
 * are cut between them, then whatever grass cannot be walked to from the
 * spawn is grown over again. The rectangle is cut into eight areas, one on
 * each side and corner of the clearing, so that two agents changing
 * different regions edit different files.
 *
 * It is the same land every run: all randomness comes from SEED. The
 * clearing is never written, only read, for its rows and to check that the
 * trails meet its exits.
 *
 * This script records how the areas were first made. They are meant to be
 * edited by hand afterwards, and running it again overwrites those edits:
 * rerun it only to lay the whole land out anew.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AREAS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/content/world/areas');
const SEED = 48;

const TREE = 'T';
const GRASS = '.';
const ROCK = 'o';

/** The clearing: world tiles (0, 0) to (39, 29). Its rows are read from its file. */
const CLEARING = { column: 0, row: 0, width: 40, height: 30 };
/** Every tile of the land, the clearing included. */
const LAND = { column: -45, row: -31, width: 130, height: 92 };
/** Trees this thick close the land on every side. */
const BORDER_TILES = 2;
const SPAWN = { column: 6, row: 14 };
/** How many tiles apart the random values lie that the ragged edge of a place is drawn between. */
const TILES_PER_LATTICE_STEP = 4;

/**
 * The eight areas, each the size of the clearing or a little larger. Together
 * with the clearing they cover the land exactly.
 */
const AREAS = [
  {
    file: 'oldGrove',
    name: 'old-grove',
    rectangle: { column: -45, row: -31, width: 45, height: 31 },
    about: ['North-west of the clearing: thick forest with three small glades in it,', 'joined by trails. The trail south leads to the west woods, the one east to', 'the north meadow.'],
  },
  {
    file: 'northMeadow',
    name: 'north-meadow',
    rectangle: { column: 0, row: -31, width: 40, height: 31 },
    about: ['North of the clearing: a wide meadow. The trail from the clearing\'s north', 'exit ends here, with a hidden glade off it on the way; others leave west', 'to the old grove and east to the rock field.'],
  },
  {
    file: 'rockField',
    name: 'rock-field',
    rectangle: { column: 40, row: -31, width: 45, height: 31 },
    about: ['North-east of the clearing: open ground strewn with rocks. A trail runs', 'south from it to the east glade.'],
  },
  {
    file: 'westWoods',
    name: 'west-woods',
    rectangle: { column: -45, row: 0, width: 45, height: 30 },
    about: ['West of the clearing, through its west exit: thin woods, trees standing', 'apart with grass between them. Trails leave north to the old grove and', 'south to the stone hollow.'],
  },
  {
    file: 'eastGlade',
    name: 'east-glade',
    rectangle: { column: 40, row: 0, width: 45, height: 30 },
    about: ['East of the clearing, through its east exit: a long glade, with a small', 'one north-east of it on the trail down from the rock field. A trail', 'leaves south to the far clearing, past a glade at its side.'],
  },
  {
    file: 'stoneHollow',
    name: 'stone-hollow',
    rectangle: { column: -45, row: 30, width: 45, height: 31 },
    about: ['South-west of the clearing: a round hollow with a ring of standing', 'stones in it. Trails leave north to the west woods and east to the south', 'glade.'],
  },
  {
    file: 'southGlade',
    name: 'south-glade',
    rectangle: { column: 0, row: 30, width: 40, height: 31 },
    about: ['South of the clearing, through its south exit: a glade. Trails leave west', 'to the stone hollow and east to the far clearing.'],
  },
  {
    file: 'farClearing',
    name: 'far-clearing',
    rectangle: { column: 40, row: 30, width: 45, height: 31 },
    about: ['South-east of the clearing, the furthest place from the spawn: a large', 'clearing with clumps of trees, and a nook in the corner of the world', 'beyond it.'],
  },
];

/**
 * Ground cleared out of the forest: an ellipse around `centre` with a ragged
 * edge. `trees` and `rocks` are how much of it is left standing or strewn,
 * as a share of its tiles.
 */
const PLACES = [
  { name: 'north meadow', centre: { column: 18, row: -17 }, radiusColumns: 15, radiusRows: 8, trees: 0.012, rocks: 0.006 },
  { name: 'old grove, northern glade', centre: { column: -30, row: -22 }, radiusColumns: 6, radiusRows: 5, trees: 0.02, rocks: 0.02 },
  { name: 'old grove, eastern glade', centre: { column: -17, row: -12 }, radiusColumns: 5, radiusRows: 4, trees: 0, rocks: 0.03 },
  { name: 'old grove, western glade', centre: { column: -35, row: -9 }, radiusColumns: 5, radiusRows: 4, trees: 0.02, rocks: 0 },
  { name: 'rock field', centre: { column: 62, row: -16 }, radiusColumns: 16, radiusRows: 10, trees: 0.004, rocks: 0.1 },
  { name: 'west woods', centre: { column: -23, row: 15 }, radiusColumns: 18, radiusRows: 11, trees: 0.13, rocks: 0.008 },
  { name: 'east glade', centre: { column: 62, row: 14 }, radiusColumns: 15, radiusRows: 6, trees: 0.015, rocks: 0.012 },
  { name: 'east glade, small glade', centre: { column: 77, row: 4 }, radiusColumns: 4, radiusRows: 4, trees: 0, rocks: 0.03 },
  { name: 'stone hollow', centre: { column: -26, row: 45 }, radiusColumns: 10, radiusRows: 9, trees: 0, rocks: 0 },
  { name: 'south glade', centre: { column: 18, row: 44 }, radiusColumns: 12, radiusRows: 7, trees: 0.02, rocks: 0.01 },
  { name: 'far clearing', centre: { column: 64, row: 46 }, radiusColumns: 15, radiusRows: 9, trees: 0.05, rocks: 0.008 },
  { name: 'hidden glade', centre: { column: 10, row: -5 }, radiusColumns: 5, radiusRows: 3, trees: 0, rocks: 0.03 },
  { name: 'trailside glade', centre: { column: 47, row: 27 }, radiusColumns: 5, radiusRows: 4, trees: 0.03, rocks: 0.02 },
  { name: 'corner nook', centre: { column: 79, row: 56 }, radiusColumns: 3, radiusRows: 2, trees: 0, rocks: 0 },
];

/** The stones of the hollow stand on a circle around its centre, with a way in at each compass point. */
const STONE_RING = { centre: { column: -26, row: 45 }, radius: 5, stones: 16 };

/** Trails of grass, two tiles wide, each a list of tiles it passes through. The first four start at the clearing's exits. */
const TRAILS = [
  [{ column: -1, row: 10 }, { column: -8, row: 12 }],
  [{ column: 34, row: -1 }, { column: 32, row: -7 }, { column: 26, row: -13 }],
  [{ column: 40, row: 21 }, { column: 52, row: 16 }],
  [{ column: 20, row: 30 }, { column: 19, row: 39 }],
  [{ column: 5, row: -17 }, { column: -6, row: -14 }, { column: -15, row: -12 }],
  [{ column: -20, row: -14 }, { column: -27, row: -19 }],
  [{ column: -21, row: -11 }, { column: -32, row: -9 }],
  [{ column: -36, row: -6 }, { column: -34, row: 1 }, { column: -30, row: 8 }],
  [{ column: 32, row: -18 }, { column: 40, row: -20 }, { column: 49, row: -17 }],
  [{ column: 68, row: -8 }, { column: 74, row: -3 }, { column: 77, row: 3 }],
  [{ column: 76, row: 7 }, { column: 74, row: 10 }, { column: 71, row: 13 }],
  [{ column: 63, row: 19 }, { column: 60, row: 28 }, { column: 63, row: 39 }],
  [{ column: 8, row: 45 }, { column: -4, row: 48 }, { column: -17, row: 45 }],
  [{ column: 29, row: 45 }, { column: 39, row: 42 }, { column: 50, row: 46 }],
  [{ column: -28, row: 37 }, { column: -31, row: 31 }, { column: -27, row: 25 }],
  [{ column: 75, row: 51 }, { column: 78, row: 55 }],
  [{ column: 32, row: -7 }, { column: 22, row: -4 }, { column: 13, row: -5 }],
  [{ column: 60, row: 28 }, { column: 51, row: 27 }],
];

main();

function main() {
  const clearingRows = readClearingRows();
  const random = seededRandom(SEED);
  const land = filledGrid(TREE);
  /** Tiles nothing may be put on: trails, so that no rock or tree closes one. */
  const keptClear = new Set();

  for (const place of PLACES) clearPlace(land, place);
  for (const trail of TRAILS) cutTrail(land, keptClear, trail);
  for (const place of PLACES) scatterInPlace(land, { place, keptClear, random });
  standStoneRing(land);
  closeBorder(land);
  layClearing(land, clearingRows);
  const overgrown = growOverUnreachableGrass(land);

  checkLand(land);
  for (const area of AREAS) writeFileSync(path.join(AREAS_FOLDER, `${area.file}.ts`), areaFileText(area, rowsOf(land, area.rectangle)));

  const kinds = land.flat();
  const countOf = (wanted) => kinds.filter((kind) => kind === wanted).length;
  console.log(`land ${LAND.width}x${LAND.height} = ${kinds.length} tiles (${(kinds.length / (CLEARING.width * CLEARING.height)).toFixed(2)} times the clearing)`);
  console.log(`grass ${countOf(GRASS)}, trees ${countOf(TREE)}, rocks ${countOf(ROCK)}, grass grown over because it could not be reached: ${overgrown}`);
  console.log(`wrote ${AREAS.map((area) => `${area.file}.ts`).join(', ')}`);
}

// ---- Laying out the land ----

function filledGrid(kind) {
  return Array.from({ length: LAND.height }, () => Array.from({ length: LAND.width }, () => kind));
}

function isInLand({ column, row }) {
  return column >= LAND.column && column < LAND.column + LAND.width && row >= LAND.row && row < LAND.row + LAND.height;
}

function isInClearing({ column, row }) {
  return column >= CLEARING.column && column < CLEARING.column + CLEARING.width && row >= CLEARING.row && row < CLEARING.row + CLEARING.height;
}

function tileOf(land, { column, row }) {
  return isInLand({ column, row }) ? land[row - LAND.row][column - LAND.column] : undefined;
}

/** Puts a tile on the land. The clearing is not this script's to change, and tiles off the land do not exist. */
function putTile(land, tile, kind) {
  if (!isInLand(tile) || isInClearing(tile)) return;
  land[tile.row - LAND.row][tile.column - LAND.column] = kind;
}

function tilesOfLand() {
  const tiles = [];
  for (let row = LAND.row; row < LAND.row + LAND.height; row += 1) {
    for (let column = LAND.column; column < LAND.column + LAND.width; column += 1) tiles.push({ column, row });
  }
  return tiles;
}

/** Whether a tile is part of a place: inside its ellipse, whose edge moves in and out with `raggedness`. */
function isInPlace(place, { column, row }) {
  const acrossColumns = (column - place.centre.column) / place.radiusColumns;
  const acrossRows = (row - place.centre.row) / place.radiusRows;
  return acrossColumns * acrossColumns + acrossRows * acrossRows < 1 + 0.3 * raggedness(column, row);
}

function clearPlace(land, place) {
  for (const tile of tilesOfLand()) if (isInPlace(place, tile)) putTile(land, tile, GRASS);
}

/** Cuts a trail through its waypoints. Between two of them it bends to one side and comes back, so no trail is a ruler line. */
function cutTrail(land, keptClear, waypoints) {
  for (let index = 0; index + 1 < waypoints.length; index += 1) {
    const from = waypoints[index];
    const to = waypoints[index + 1];
    const length = Math.hypot(to.column - from.column, to.row - from.row);
    const bend = (index % 2 === 0 ? 1 : -1) * Math.min(3, length / 4);
    const steps = Math.ceil(length * 3);
    for (let step = 0; step <= steps; step += 1) {
      const shareOfTheWay = step / steps;
      const tilesToTheSide = bend * Math.sin(Math.PI * shareOfTheWay);
      const column = Math.round(from.column + (to.column - from.column) * shareOfTheWay - ((to.row - from.row) / length) * tilesToTheSide);
      const row = Math.round(from.row + (to.row - from.row) * shareOfTheWay + ((to.column - from.column) / length) * tilesToTheSide);
      for (const tile of [{ column, row }, { column: column + 1, row }, { column, row: row + 1 }, { column: column + 1, row: row + 1 }]) {
        putTile(land, tile, GRASS);
        keptClear.add(keyOf(tile));
      }
    }
  }
}

/** Leaves trees standing and strews rocks over a place's grass, never on a trail. */
function scatterInPlace(land, { place, keptClear, random }) {
  for (const tile of tilesOfLand()) {
    // One random number per tile whatever is on it, so changing one place does not reshuffle the others.
    const randomShare = random();
    if (!isInPlace(place, tile) || isInClearing(tile) || keptClear.has(keyOf(tile)) || tileOf(land, tile) !== GRASS) continue;
    if (randomShare < place.trees) putTile(land, tile, TREE);
    else if (randomShare < place.trees + place.rocks) putTile(land, tile, ROCK);
  }
}

function standStoneRing(land) {
  for (let stone = 0; stone < STONE_RING.stones; stone += 1) {
    // A way in at each compass point: every fourth stone is left out.
    if (stone % 4 === 0) continue;
    const angle = (2 * Math.PI * stone) / STONE_RING.stones;
    putTile(land, { column: Math.round(STONE_RING.centre.column + STONE_RING.radius * Math.cos(angle)), row: Math.round(STONE_RING.centre.row + STONE_RING.radius * Math.sin(angle)) }, ROCK);
  }
}

function closeBorder(land) {
  for (const tile of tilesOfLand()) {
    const fromEdge = Math.min(tile.column - LAND.column, tile.row - LAND.row, LAND.column + LAND.width - 1 - tile.column, LAND.row + LAND.height - 1 - tile.row);
    if (fromEdge < BORDER_TILES) putTile(land, tile, TREE);
  }
}

function layClearing(land, clearingRows) {
  clearingRows.forEach((clearingRow, rowIndex) => {
    [...clearingRow].forEach((kind, columnIndex) => {
      land[CLEARING.row + rowIndex - LAND.row][CLEARING.column + columnIndex - LAND.column] = kind;
    });
  });
}

/** Turns every walkable tile that cannot be walked to from the spawn into a tree, and says how many there were. */
function growOverUnreachableGrass(land) {
  const reached = tilesReachableFrom(land, SPAWN);
  let overgrown = 0;
  for (const tile of tilesOfLand()) {
    if (tileOf(land, tile) !== GRASS || reached.has(keyOf(tile))) continue;
    if (isInClearing(tile)) throw new Error(`Clearing tile (${tile.column}, ${tile.row}) cannot be reached from the spawn`);
    putTile(land, tile, TREE);
    overgrown += 1;
  }
  return overgrown;
}

/** The grass tiles that can be reached from `start` by stepping up, down, left or right over grass, as keys. */
function tilesReachableFrom(land, start) {
  const reached = new Set();
  const toVisit = [start];
  while (toVisit.length > 0) {
    const tile = toVisit.pop();
    if (reached.has(keyOf(tile)) || tileOf(land, tile) !== GRASS) continue;
    reached.add(keyOf(tile));
    toVisit.push({ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 });
  }
  return reached;
}

/**
 * Refuses a land that lost a place (one whose centre cannot be walked to),
 * whose areas do not cover it exactly, or where an exit of the clearing
 * opens onto a tree instead of a trail.
 */
function checkLand(land) {
  const reached = tilesReachableFrom(land, SPAWN);
  for (const tile of tilesOfLand()) {
    if (!isInClearing(tile) || tileOf(land, tile) !== GRASS) continue;
    for (const outside of [{ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 }]) {
      if (isInLand(outside) && !isInClearing(outside) && tileOf(land, outside) !== GRASS) throw new Error(`The clearing's exit at (${tile.column}, ${tile.row}) meets no trail: (${outside.column}, ${outside.row}) is not grass`);
    }
  }
  for (const place of PLACES) {
    const nearCentre = tilesOfLand().filter((tile) => Math.abs(tile.column - place.centre.column) <= 1 && Math.abs(tile.row - place.centre.row) <= 1);
    if (!nearCentre.some((tile) => reached.has(keyOf(tile)))) throw new Error(`The ${place.name} cannot be reached from the spawn`);
  }
  const covered = new Set();
  for (const { rectangle } of [...AREAS, { rectangle: CLEARING }]) {
    for (let row = rectangle.row; row < rectangle.row + rectangle.height; row += 1) {
      for (let column = rectangle.column; column < rectangle.column + rectangle.width; column += 1) {
        const key = keyOf({ column, row });
        if (covered.has(key) || !isInLand({ column, row })) throw new Error(`Tile (${column}, ${row}) is in two areas or off the land`);
        covered.add(key);
      }
    }
  }
  if (covered.size !== LAND.width * LAND.height) throw new Error('The areas leave part of the land uncovered');
}

// ---- Randomness, the same every run ----

/** A generator of numbers from 0 to 1 that gives the same sequence for the same seed (mulberry32). */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from -1 to 1 for a lattice point, the same every time. */
function latticeValue(column, row) {
  let hash = (Math.imul(column, 0x27d4eb2d) ^ Math.imul(row, 0x165667b1) ^ SEED) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 2147483648 - 1;
}

/** A number from -1 to 1 that changes smoothly from tile to tile, over about four tiles: what makes the edge of a place ragged. */
function raggedness(column, row) {
  const latticeColumn = Math.floor(column / TILES_PER_LATTICE_STEP);
  const latticeRow = Math.floor(row / TILES_PER_LATTICE_STEP);
  const acrossColumn = smooth(column / TILES_PER_LATTICE_STEP - latticeColumn);
  const acrossRow = smooth(row / TILES_PER_LATTICE_STEP - latticeRow);
  const alongTopEdge = mix(latticeValue(latticeColumn, latticeRow), latticeValue(latticeColumn + 1, latticeRow), acrossColumn);
  const alongBottomEdge = mix(latticeValue(latticeColumn, latticeRow + 1), latticeValue(latticeColumn + 1, latticeRow + 1), acrossColumn);
  return mix(alongTopEdge, alongBottomEdge, acrossRow);
}

function smooth(share) {
  return share * share * (3 - 2 * share);
}

function mix(from, to, share) {
  return from + (to - from) * share;
}

function keyOf({ column, row }) {
  return `${column},${row}`;
}

// ---- Files ----

/** The clearing's rows, read out of its file: the quoted strings of its `rows` list. */
function readClearingRows() {
  const source = readFileSync(path.join(AREAS_FOLDER, 'clearing.ts'), 'utf8');
  const rows = [...source.slice(source.indexOf('rows: [')).matchAll(/^\s*'([^']+)',$/gm)].map((match) => match[1]);
  if (rows.length !== CLEARING.height || rows.some((clearingRow) => clearingRow.length !== CLEARING.width)) {
    throw new Error(`Expected ${CLEARING.height} rows of ${CLEARING.width} tiles in clearing.ts, read ${rows.length}`);
  }
  return rows;
}

function rowsOf(land, rectangle) {
  const rows = [];
  for (let row = rectangle.row; row < rectangle.row + rectangle.height; row += 1) {
    rows.push(land[row - LAND.row].slice(rectangle.column - LAND.column, rectangle.column - LAND.column + rectangle.width).join(''));
  }
  return rows;
}

function areaFileText(area, rows) {
  const usesRocks = rows.some((areaRow) => areaRow.includes(ROCK));
  return [
    "import { TerrainDefId } from '../../../features/terrain/defs';",
    "import type { AreaData } from '../types';",
    '',
    '/**',
    ...area.about.map((line) => ` * ${line}`),
    ' *',
    ` * ${area.rectangle.width}x${area.rectangle.height} tiles, first laid out by packages/sim/tools/generate-world-areas.mjs.`,
    ' * To change the land, edit the rows here by hand, not the script. Every',
    ' * grass tile must stay within reach of the spawn (a test checks it).',
    ' */',
    `export const ${area.file}: AreaData = {`,
    `  name: '${area.name}',`,
    `  origin: { column: ${area.rectangle.column}, row: ${area.rectangle.row} },`,
    '  legend: {',
    '    T: TerrainDefId.Tree,',
    "    '.': TerrainDefId.Grass,",
    ...(usesRocks ? ['    o: TerrainDefId.Rock,'] : []),
    '  },',
    '  rows: [',
    ...rows.map((areaRow) => `    '${areaRow}',`),
    '  ],',
    '};',
    '',
  ].join('\n');
}
