/* global window, document */
/**
 * Plays the region in the browser the way a person does: starts
 * `VITE_REGION_MAP=alps PORT=<n> pnpm dev`, looks for real places at the
 * latitude and longitude an atlas gives them, walks into a lake and across a
 * river with the keyboard, and takes a screenshot at each of a handful of
 * places, plus one picture of the whole map.
 *
 * The coordinates below are typed from an atlas and are the only numbers
 * that do not come from the game. What a tile is called, which tiles stop a
 * player and where a place falls on the map are all read from
 * `window.__novaland`.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Not the port of the dev server left running for the human (5170). */
const PORT = 5970;
const VIEWPORT = { width: 960, height: 720 };
const CHARACTER = { name: 'Walker', look: { skin: 0, hair: 0, clothes: 0, gender: 0, hairStyle: 0 } };

/** Open water: the tile at the place must be water (deep or shallows). */
const OPEN_WATER = {
  'Lake Geneva': [46.45, 6.55],
  'Lake Neuchâtel': [46.9, 6.85],
  'Lake Constance': [47.6, 9.45],
  'Lake Zurich': [47.25, 8.65],
  'Lake Maggiore': [45.95, 8.63],
  'Lake Como': [46.03, 9.27],
  'Lake Garda': [45.6, 10.63],
  'the Adriatic off Venice': [45.3, 12.6],
  'the Gulf of Genoa': [44.33, 8.95],
};
/** Summits: the tile at the place must stop a player, and there is ice or summit within a tile of it. */
const HIGH_PEAKS = {
  'Mont Blanc': [45.833, 6.865],
  'Monte Rosa': [45.937, 7.867],
  'the Aletsch glacier': [46.5, 8.03],
  'Piz Bernina': [46.382, 9.908],
  Ortler: [46.509, 10.545],
  Grossglockner: [47.074, 12.694],
};
/** The plain: the tile at the place must be grass. */
const ON_THE_PLAIN = { Milan: [45.46, 9.19], Turin: [45.07, 7.69], 'south of Lake Garda': [45.2, 10.5] };
/** Rivers: there must be a river tile within two tiles of the town. */
const RIVERS_AT_TOWNS = {
  'the Po at Piacenza': [45.06, 9.7],
  'the Po at Turin': [45.06, 7.7],
  'the Rhône at Sion': [46.23, 7.36],
  'the Rhine at Chur': [46.85, 9.52],
  'the Inn at Innsbruck': [47.27, 11.39],
  'the Adige at Trento': [46.07, 11.11],
  'the Adige at Verona': [45.44, 10.99],
  'the Aare at Bern': [46.95, 7.45],
  'the Adda at Sondrio': [46.17, 9.87],
  'the Ticino at Pavia': [45.18, 9.15],
};
/** Where the screenshots are taken: the walk starts on the walkable tile nearest to each. */
const VIEWS = {
  geneva: [46.21, 6.16],
  'mont-blanc': [45.92, 6.87],
  aletsch: [46.4, 8.13],
  'lake-maggiore': [45.92, 8.55],
  'po-at-piacenza': [45.1, 9.7],
  'venice-lagoon': [45.49, 12.25],
};

const results = [];
const report = { places: {}, views: {} };
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT), VITE_REGION_MAP: 'alps' } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up with VITE_REGION_MAP=alps, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, CHARACTER);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));

  // ---- The region is what is played ----
  await openAt(page);
  const region = await page.evaluate(() => {
    const api = window.__novaland;
    return { name: api.region?.name, grid: api.region?.grid, sources: api.region?.sources, bounds: api.tiles.bounds, spawn: api.map.spawn, playerSpeed: api.defs.find((def) => def.speed)?.speed };
  });
  report.region = region;
  results.push(check('the page plays the region "alps", not the world', region.name === 'alps', `${region.bounds.width}x${region.bounds.height} tiles of ${region.grid?.kilometresPerTile} km`));
  results.push(check('the region names its three sources with a licence each', region.sources?.length === 3 && region.sources.every((source) => source.licence && source.credit), region.sources?.map((source) => `${source.name} (${source.licence.split(':')[0]})`).join('; ')));
  const start0 = await playerOf(page);
  results.push(check('the player stands on the spawn tile, at the south end of Lake Como', start0.tile.column === region.spawn.column && start0.tile.row === region.spawn.row && (await kindsWithin(page, [45.8, 9.07], 3)).includes('shallows'), `tile (${start0.tile.column}, ${start0.tile.row})`));
  await page.screenshot({ path: path.join(PROOF, '02-view-spawn-lake-como.png') });

  // ---- Real places are where an atlas says ----
  for (const [name, coordinates] of Object.entries(OPEN_WATER)) {
    const place = await placeAt(page, coordinates);
    report.places[name] = place;
    results.push(check(`${name} is water`, place.kind === 'water' || place.kind === 'shallows', describe(place)));
  }
  for (const [name, coordinates] of Object.entries(HIGH_PEAKS)) {
    const place = await placeAt(page, coordinates);
    const near = await kindsWithin(page, coordinates, 1);
    report.places[name] = { ...place, near };
    results.push(check(`${name} is ice or summit, and stops a walker`, place.solid === true && (near.includes('glacier') || near.includes('summit')), `${describe(place)}; within a tile: ${near.join(', ')}`));
  }
  for (const [name, coordinates] of Object.entries(ON_THE_PLAIN)) {
    const place = await placeAt(page, coordinates);
    report.places[name] = place;
    results.push(check(`${name} is open grass on the plain`, place.kind === 'grass', describe(place)));
  }
  for (const [name, coordinates] of Object.entries(RIVERS_AT_TOWNS)) {
    const near = await kindsWithin(page, coordinates, 2);
    report.places[name] = { ...(await placeAt(page, coordinates)), near };
    results.push(check(`${name}: a river runs within two tiles`, near.includes('river'), near.join(', ')));
  }

  // ---- The whole map, one square per tile, in each tile def's colour ----
  const overview = await page.evaluate((pixelsPerTile) => {
    const api = window.__novaland;
    const { width, height } = api.tiles.bounds;
    const colorOfDef = new Map(api.defs.map((def) => [def.id, def.color]));
    const canvas = document.createElement('canvas');
    canvas.width = width * pixelsPerTile;
    canvas.height = height * pixelsPerTile;
    const context = canvas.getContext('2d');
    const tilesByKind = {};
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const defId = api.tileDefIdAt({ column, row });
        const name = api.defs.find((def) => def.id === defId)?.name ?? 'nothing';
        tilesByKind[name] = (tilesByKind[name] ?? 0) + 1;
        context.fillStyle = `#${(colorOfDef.get(defId) ?? 0).toString(16).padStart(6, '0')}`;
        context.fillRect(column * pixelsPerTile, row * pixelsPerTile, pixelsPerTile, pixelsPerTile);
      }
    }
    return { png: canvas.toDataURL('image/png').split(',')[1], tilesByKind };
  }, 3);
  writeFileSync(path.join(PROOF, '02-whole-map.png'), Buffer.from(overview.png, 'base64'));
  report.tilesByKind = overview.tilesByKind;
  results.push(check('every tile of the map is a tile the game knows', overview.tilesByKind.nothing === undefined, Object.entries(overview.tilesByKind).map(([kind, count]) => `${kind} ${count}`).join(', ')));

  // ---- A lake stops a walker ----
  await openAt(page, OPEN_WATER['Lake Geneva']);
  const shore = await playerOf(page);
  const lake = await placeAt(page, OPEN_WATER['Lake Geneva']);
  const towardsLake = keyTowards(shore.tile, lake.tile);
  await holdKey(page, towardsLake, 2500);
  const atTheWater = await playerOf(page);
  await holdKey(page, towardsLake, 500);
  const stillAtTheWater = await playerOf(page);
  report.lake = { shore, lake: lake.tile, key: towardsLake, atTheWater, stillAtTheWater };
  results.push(check('a walker who starts in the middle of Lake Geneva is put on its shore', shore.solid === false && shore.kind !== 'river', `tile (${shore.tile.column}, ${shore.tile.row}): ${shore.kind}`));
  results.push(check(`walking towards the lake (${towardsLake}) ends on dry ground at the water's edge, and pushing on moves nobody`, atTheWater.solid === false && Math.hypot(stillAtTheWater.x - atTheWater.x, stillAtTheWater.y - atTheWater.y) < 0.01 && (await solidNextTo(page, atTheWater.tile)), `stopped on (${atTheWater.tile.column}, ${atTheWater.tile.row}): ${atTheWater.kind}`));

  // ---- A river does not ----
  await openAt(page, VIEWS['po-at-piacenza']);
  const northBank = await playerOf(page);
  const kindsWalked = new Set();
  await page.keyboard.down('KeyS');
  for (let sample = 0; sample < 40; sample += 1) {
    kindsWalked.add((await playerOf(page)).kind);
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('KeyS');
  const southBank = await playerOf(page);
  report.river = { northBank, southBank, kindsWalked: [...kindsWalked] };
  results.push(check('walking south from north of Piacenza wades across the Po and carries on', kindsWalked.has('river') && southBank.kind !== 'river' && southBank.tile.row - northBank.tile.row > 8, `from row ${northBank.tile.row} to row ${southBank.tile.row}, over ${[...kindsWalked].join(', ')}`));
  results.push(check('the walk covers ground at the speed of the player def: a tile is 1.2 km, so about 6 km a second', Math.abs((southBank.y - northBank.y) / 4 - region.playerSpeed) < region.playerSpeed * 0.35, `${((southBank.y - northBank.y) / 4).toFixed(1)} tiles a second against a speed of ${region.playerSpeed}`));

  // ---- What a player sees at a handful of places ----
  for (const [name, coordinates] of Object.entries(VIEWS)) {
    await openAt(page, coordinates);
    const asked = await placeAt(page, coordinates);
    const player = await playerOf(page);
    const terrain = await waitFor('terrain drawn', { read: () => page.evaluate(() => window.__novaland.terrain()), until: (drawn) => drawn && drawn.chunksDrawn.length > 0 });
    const camera = await page.evaluate(() => window.__novaland.camera());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(PROOF, `02-view-${name}.png`) });
    report.views[name] = { asked: asked.tile, player: player.tile, kind: player.kind, chunksDrawn: terrain.chunksDrawn.length, zoom: camera?.zoom, visibleMetres: camera?.visibleMetres };
    const tilesAway = Math.max(Math.abs(player.tile.column - asked.tile.column), Math.abs(player.tile.row - asked.tile.row));
    results.push(check(`?at=${coordinates.join(',')} (${name}) starts the walk within a few tiles of the place, on walkable ground, with terrain drawn`, tilesAway <= 6 && player.solid === false, `${tilesAway} tiles away on ${player.kind}, ${terrain.chunksDrawn.length} chunks drawn, ${Math.round(camera.visibleMetres.width)}x${Math.round(camera.visibleMetres.height)} tiles on screen`));
  }

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('02-walk.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Opens the game with the walk starting at a latitude and a longitude, or at the region's own spawn, and waits for the player to stand in the world. */
async function openAt(page, coordinates) {
  await page.goto(`http://localhost:${PORT}/${coordinates ? `?at=${coordinates.join(',')}` : ''}`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.terrain()?.chunksDrawn.length > 0, null, { timeout: 20000 });
}

/** The tile a latitude and a longitude fall in, as the game places it, with the name of its tile def and whether it stops a player. */
function placeAt(page, [latitude, longitude]) {
  return page.evaluate(
    ([latitude, longitude]) => {
      const api = window.__novaland;
      const tile = api.tileOfCoordinates({ latitude, longitude });
      const def = tile && api.defs.find((candidate) => candidate.id === api.tileDefIdAt(tile));
      return { tile, kind: def?.name, solid: def?.solid };
    },
    [latitude, longitude],
  );
}

/** The names of the tile defs within `radius` tiles of a place. */
function kindsWithin(page, [latitude, longitude], radius) {
  return page.evaluate(
    ([latitude, longitude, radius]) => {
      const api = window.__novaland;
      const centre = api.tileOfCoordinates({ latitude, longitude });
      const kinds = new Set();
      for (let row = centre.row - radius; row <= centre.row + radius; row += 1) {
        for (let column = centre.column - radius; column <= centre.column + radius; column += 1) {
          const def = api.defs.find((candidate) => candidate.id === api.tileDefIdAt({ column, row }));
          if (def) kinds.add(def.name);
        }
      }
      return [...kinds];
    },
    [latitude, longitude, radius],
  );
}

/** Where the local player is, in metres and as a tile, and what that tile is. */
function playerOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const { x, y } = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot).components.Position;
    const tile = api.tileAt(x, y);
    const def = api.defs.find((candidate) => candidate.id === api.tileDefIdAt(tile));
    return { x, y, tile, kind: def?.name, solid: def?.solid };
  });
}

/** Whether one of the four tiles beside a tile stops a player. */
function solidNextTo(page, tile) {
  return page.evaluate(({ column, row }) => {
    const api = window.__novaland;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([columnOffset, rowOffset]) => api.defs.find((def) => def.id === api.tileDefIdAt({ column: column + columnOffset, row: row + rowOffset }))?.solid === true);
  }, tile);
}

/** The key that walks from one tile towards another along the axis they are furthest apart on. */
function keyTowards(from, to) {
  const columns = to.column - from.column;
  const rows = to.row - from.row;
  if (Math.abs(columns) > Math.abs(rows)) return columns > 0 ? 'KeyD' : 'KeyA';
  return rows > 0 ? 'KeyS' : 'KeyW';
}

async function holdKey(page, key, milliseconds) {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

function describe(place) {
  return place.tile ? `tile (${place.tile.column}, ${place.tile.row}): ${place.kind}` : 'outside the region';
}
