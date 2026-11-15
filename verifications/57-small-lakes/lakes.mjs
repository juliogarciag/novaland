/* global window, requestAnimationFrame */
/**
 * The lakes, in the running game: starts `PORT=<n> pnpm dev`, opens the page
 * in Chromium and plays it.
 *
 * 1. Reads the world through `window.__novaland` and finds every lake (water
 *    and shallows tiles that touch side to side): deep water in the middle,
 *    a ring of shallows between it and the land.
 * 2. Walks from the spawn to a lake with the keyboard, as a person does
 *    (the shortest walk of two keys that ends in water), wades into the
 *    shallows and keeps walking: the player must stop at the edge of the
 *    deep water. Screenshot.
 * 3. Walks on to every other lake over walkable tiles alone (which also shows
 *    each one can be reached), wades in, pushes into its deep water, checks
 *    the player is held in the shallows and that the lake is drawn as one:
 *    dark water, paler shallows, a bank of earth where the shallows meet the
 *    grass and nothing there brighter than the water.
 *    Screenshot of each.
 * 4. Paints the whole world from the tile defs' colours, the way a minimap
 *    does, to show the lakes read at that size.
 *
 * Nothing about where the lakes are is typed in here: it all comes from the map.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Not 5157: that is the dev server left running for the human. */
const PORT = 5957;
const VIEWPORT = { width: 960, height: 720 };
/** The ticket asks for screenshots of at least three lakes. */
const LAKES_THE_TICKET_ASKS_FOR = 3;
/** The corner of the screenshot the HUD covers, in pixels, with room to spare. */
const HUD_CORNER = { width: 300, height: 85 };
/** Side of one tile of the world-by-colour picture, in pixels. */
const OVERVIEW_TILE_PIXELS = 6;

const results = [];
const report = {};
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean, timeoutMs: 20000 }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.camera() !== undefined, null, { timeout: 20000 });
  await page.evaluate(installWalker);

  // ---- 1. The world as the game has it ----
  const world = await page.evaluate(() => window.__lakes.readWorld());
  report.water = world.water;
  report.shallows = world.shallows;
  report.lakes = world.lakes.map(({ tiles, deep, shallows, ...lake }) => ({ ...lake, tileCount: tiles.length, deepTiles: deep.length, shallowsTiles: shallows.length }));
  results.push(check('water is a tile def of its own: solid, flat, with a colour', world.water !== undefined && world.water.solid === true && world.water.standingSprite === undefined && Number.isInteger(world.water.color), JSON.stringify(world.water)));
  results.push(check('the shallows are a tile def of their own: walked on, flat, with a colour', world.shallows !== undefined && world.shallows.solid === false && world.shallows.standingSprite === undefined && Number.isInteger(world.shallows.color), JSON.stringify(world.shallows)));
  results.push(check(`the world has several lakes: at least ${LAKES_THE_TICKET_ASKS_FOR}`, world.lakes.length >= LAKES_THE_TICKET_ASKS_FOR, world.lakes.map((lake) => `${lake.area} (${lake.tiles.length} tiles)`).join(', ')));
  results.push(check('no lake is a plain rectangle', world.lakes.every((lake) => lake.tiles.length < lake.box.width * lake.box.height), world.lakes.map((lake) => `${lake.tiles.length}/${lake.box.width}x${lake.box.height}`).join(' ')));
  const lakesNearSpawn = world.lakes.filter((lake) => lake.tilesFromSpawn <= 10);
  results.push(check('no lake is on the spawn or near it: none within ten tiles', lakesNearSpawn.length === 0, `nearest water is ${Math.min(...world.lakes.map((lake) => lake.tilesFromSpawn))} tiles from the spawn tile`));
  const landBesideDeep = world.lakes.filter((lake) => lake.deepTilesTouchingLand > 0);
  results.push(check('every lake has a coast all the way round: deep water in the middle, never touching the land, not even at a corner', world.lakes.every((lake) => lake.deep.length > 0 && lake.shallows.length > 0) && landBesideDeep.length === 0, world.lakes.map((lake) => `${lake.area} ${lake.deep.length} deep + ${lake.shallows.length} shallows`).join(', ')));
  const smallest = Math.min(...world.lakes.map((lake) => Math.min(lake.box.width, lake.box.height)));
  results.push(check('the lakes are bigger than a pond: every one at least six tiles across both ways', smallest >= 6, world.lakes.map((lake) => `${lake.area} ${lake.box.width}x${lake.box.height}`).join(', ')));
  for (const def of [world.water, world.shallows]) {
    results.push(check(`the ${def.name} sheet loaded: lakes are drawn from it, not from the flat fallback`, await page.evaluate((key) => window.__novaland.game.textures.exists(key), def.groundSprite?.key), def.groundSprite?.key));
  }

  // ---- 2. To a lake and into it, on the keyboard ----
  const startedAt = await page.evaluate(() => window.__lakes.player());
  const route = await page.evaluate(() => window.__lakes.keyboardRouteToWater());
  report.keyboardRoute = route;
  results.push(check('from where the player stands, a walk along one row and then one column, over grass and then shallows, runs into deep water', route !== undefined, route && `${route.first.key} to column ${route.turnAt.column}, then ${route.second.key} to the water at (${route.water.column}, ${route.water.row})`));
  if (!route) throw new Error('no keyboard route to water');
  await page.keyboard.down(route.first.code);
  await waitFor('the player to reach the column of the water', { read: () => page.evaluate(() => window.__lakes.player()), until: (player) => (route.first.sign > 0 ? player.x >= route.turnAtMetres.x : player.x <= route.turnAtMetres.x), timeoutMs: 60000 });
  await page.keyboard.up(route.first.code);
  await page.keyboard.down(route.second.code);
  const atShore = await waitFor('the player to stop', { read: () => page.evaluate(() => window.__lakes.settled()), until: (state) => state.still, timeoutMs: 60000 });
  // Keep pushing into the water for a second more, key still held.
  await page.waitForTimeout(1000);
  const pushed = await page.evaluate(() => window.__lakes.settled());
  const faceMetres = route.waterFaceMetres;
  const gapToWater = route.second.sign > 0 ? faceMetres - (pushed.y + pushed.radius) : pushed.y - pushed.radius - faceMetres;
  results.push(check('walking into the lake on the keyboard, the player wades in and stops at the edge of the deep water', pushed.still && pushed.intent[route.second.axis] === route.second.sign && Math.abs(gapToWater) < 0.05, `moved ${Math.hypot(pushed.x - startedAt.x, pushed.y - startedAt.y).toFixed(1)} m from the start, stopped ${gapToWater.toFixed(3)} m from the water's edge with ${route.second.key} still held`));
  results.push(check('the player stands in the shallows with deep water on the next tile', pushed.standsOn === 'shallows' && pushed.tileAhead === 'water', `on ${pushed.standsOn}, facing ${pushed.tileAhead}`));
  results.push(check('a second of pushing moves the player nowhere', Math.hypot(pushed.x - atShore.x, pushed.y - atShore.y) < 0.001, `${Math.hypot(pushed.x - atShore.x, pushed.y - atShore.y).toFixed(4)} m`));
  const shoreLake = world.lakes.find((lake) => lake.tiles.some((tile) => tile.column === route.water.column && tile.row === route.water.row));
  const shoreShot = await shoot(page, `shore-${shoreLake.area}.png`);
  results.push(checkDrawnAsWater(shoreShot, await page.evaluate((lake) => window.__lakes.onScreen(lake), shoreLake), shoreLake));
  await page.keyboard.up(route.second.code);
  // The release reaches the sim as a stop: let it land before anything else steers the player.
  await waitFor('the player to let go', { read: () => page.evaluate(() => window.__lakes.player()), until: (player) => player.intent.x === 0 && player.intent.y === 0 });
  report.shore = { lake: shoreLake.area, player: pushed, gapToWater };

  // ---- 3. Every other lake, on foot ----
  const visited = [shoreLake.area];
  let everOnSolidTile = false;
  for (const lake of world.lakes.filter((other) => other !== shoreLake).sort((nearer, farther) => nearer.tilesFromSpawn - farther.tilesFromSpawn)) {
    const walk = await page.evaluate((target) => window.__lakes.walkToShoreOf(target), lake);
    everOnSolidTile ||= walk.framesOnSolidTile > 0;
    if (!walk.arrived) {
      results.push(check(`the lake in ${lake.area} is reached on foot`, false, walk.why));
      continue;
    }
    const held = await page.evaluate((target) => window.__lakes.pushInto(target), walk.water);
    results.push(check(`the lake in ${lake.area} is reached on foot and its deep water holds the player in the shallows`, held.standsOn === 'shallows' && held.movedWhilePushing < 0.6 && held.endedOn === 'shallows', `${walk.steps} tiles walked; pushed for ${held.ticks} ticks, moved ${held.movedWhilePushing.toFixed(2)} m, still on ${held.endedOn}`));
    const shot = await shoot(page, `lake-${lake.area}.png`);
    results.push(checkDrawnAsWater(shot, await page.evaluate((target) => window.__lakes.onScreen(target), lake), lake));
    visited.push(lake.area);
  }
  report.visited = visited;
  results.push(check('every lake was visited and photographed', visited.length === world.lakes.length && visited.length >= LAKES_THE_TICKET_ASKS_FOR, visited.join(', ')));
  results.push(check('walking between the lakes, the player was on a water, tree or rock tile in no frame', !everOnSolidTile));

  // ---- 4. The world by colour alone ----
  const overview = paintWorldByColour(world);
  writeFileSync(path.join(PROOF, 'world-by-colour.png'), PNG.sync.write(overview));
  const land = world.tileColours.filter((def) => def.name !== 'water' && def.name !== 'shallows');
  for (const def of [world.water, world.shallows]) {
    const nearest = Math.min(...land.map((other) => colourDistance(other.color, def.color)));
    results.push(check(`the colour of ${def.name} is far from every tile of the land, so a view that draws tiles by colour shows the lakes`, nearest > 90, `nearest is ${nearest.toFixed(0)} away of 441: ${land.map((other) => `${other.name} ${colourDistance(other.color, def.color).toFixed(0)}`).join(', ')}`));
  }
  const betweenTheTwo = colourDistance(world.water.color, world.shallows.color);
  results.push(check('and the two blues are apart, so the same view shows the coast', betweenTheTwo > 60, `${betweenTheTwo.toFixed(0)} apart`));

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('lakes.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Takes a screenshot into proof/ and returns it decoded. */
async function shoot(page, name) {
  // Two frames, so the camera has caught up with where the player stopped.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const buffer = await page.screenshot({ path: path.join(PROOF, name) });
  return PNG.sync.read(buffer);
}

/**
 * Checks that the lake is on screen and drawn as a lake: its deep tiles blue, its shallows blue too and paler,
 * a bank where the shallows meet the grass, and the grass beside it green.
 * A tile is judged by five points of it, most of which must agree: one point may sit on a ripple or a blade.
 * Tiles the player's sprite may cover are left out by the page.
 */
function checkDrawnAsWater(shot, onScreen, lake) {
  const half = onScreen.tilePixels / 2;
  // The HUD is drawn over the top-left corner of the game: a tile under it shows text, not ground.
  const underTheHud = ({ x, y }) => x - half < HUD_CORNER.width && y - half < HUD_CORNER.height;
  const wholeTileOnScreen = (tile) => tile.x - half >= 0 && tile.y - half >= 0 && tile.x + half < shot.width && tile.y + half < shot.height && !underTheHud(tile);
  const pointsThat = (tile, matches) => pointsOfTile(tile, onScreen.tilePixels).filter(({ x, y }) => matches(pixelOf(shot, x, y))).length;
  // True of the shallows' blue as well: what tells deep from shallows is `paler` below.
  const isDeepBlue = ([red, green, blue]) => blue > red + 40 && blue > green + 30;
  // The shallows carry the coast: up to two of a tile's five points may lie on the bank instead of the water.
  const isWatery = ([red, green, blue]) => blue > red + 20 && blue >= green;
  const deep = onScreen.deep.filter(wholeTileOnScreen);
  const deepDrawn = deep.filter((tile) => pointsThat(tile, isDeepBlue) >= 4);
  const shallows = onScreen.shallows.filter(wholeTileOnScreen);
  const shallowsDrawn = shallows.filter((tile) => pointsThat(tile, isWatery) >= 3);
  const meanRed = (tiles) => tiles.reduce((sum, tile) => sum + pixelOf(shot, tile.x, tile.y)[0], 0) / tiles.length;
  const paler = meanRed(shallows) - meanRed(deep);
  // The coast is a drop into the water. On a side of the shallows with grass to the north, east or west of it, the second
  // texture pixel in is the earth of the bank; with grass to the south the bank faces away and only the dark lip of the turf shows, on the first.
  const coast = onScreen.coastSides.filter(({ tile }) => wholeTileOnScreen(tile));
  const texturePixel = onScreen.tilePixels / 16;
  const pixelsIn = (side, texturePixels) => pixelOf(shot, side.tile.x + side.towards.x * (onScreen.tilePixels / 2 - texturePixels * texturePixel), side.tile.y + side.towards.y * (onScreen.tilePixels / 2 - texturePixels * texturePixel));
  const banked = coast.filter((side) => {
    if (side.towards.y > 0) {
      const [red, green, blue] = pixelsIn(side, 0.5);
      // Darker than the grass beyond it: the turf is over 140 of green, the lip about 110.
      return green > blue + 30 && red < 100 && green < 135;
    }
    const [red, , blue] = pixelsIn(side, 1.5);
    return red > blue + 30;
  });
  // Nothing at the coast is brighter than the water: a bright rim would read as raised. Looked at as deep as the bank and its
  // shadow go on that side (six texture pixels on the far shore, three at the sides, one on the near shore): further in, a ripple may glint.
  const brightness = ([red, green, blue]) => red + green + blue;
  const waterBrightness = middleOf(shallows.map((tile) => brightness(pixelOf(shot, tile.x, tile.y))));
  const depthOfBank = (side) => (side.towards.y < 0 ? 6 : side.towards.y > 0 ? 1 : 3);
  const brightRims = coast.filter((side) => Array.from({ length: depthOfBank(side) }, (_, pixel) => pixel + 0.5).some((texturePixels) => brightness(pixelsIn(side, texturePixels)) > waterBrightness + 15));
  const grass = onScreen.grass.filter(wholeTileOnScreen);
  const green = grass.filter((tile) => pointsThat(tile, ([red, greenChannel, blue]) => greenChannel > red + 20 && greenChannel > blue + 20) >= 4);
  const pass =
    deep.length + shallows.length >= Math.ceil(lake.tiles.length / 2) &&
    deepDrawn.length === deep.length &&
    shallowsDrawn.length === shallows.length &&
    paler > 25 &&
    // A lake among trees has few sides in the open. Four is a floor against an empty look, not a promise of which shores they are on.
    coast.length >= 4 &&
    banked.length >= coast.length * 0.9 &&
    brightRims.length === 0 &&
    grass.length > 0 &&
    green.length === grass.length;
  return check(
    `the lake in ${lake.area} is on screen and drawn as a lake sunk in the ground: deep water, paler shallows, a bank of earth down to them, grass around it`,
    pass,
    `${deepDrawn.length} of ${deep.length} deep tiles looked at are blue and ${shallowsDrawn.length} of ${shallows.length} shallows tiles (${lake.tiles.length} in the lake, ${onScreen.hiddenByPlayer} behind the player); the shallows are paler by ${paler.toFixed(0)} of red; ${banked.length} of ${coast.length} sides facing grass show the bank, ${brightRims.length} a rim brighter than the water; ${green.length} of ${grass.length} tiles beside it are green`,
  );
}

/** The value in the middle of a list of numbers: half are below it. */
function middleOf(numbers) {
  return [...numbers].sort((first, second) => first - second)[Math.floor(numbers.length / 2)];
}

/** The centre of a tile on screen and the centres of its four quarters. */
function pointsOfTile({ x, y }, tilePixels) {
  const quarter = tilePixels / 4;
  return [
    { x, y },
    { x: x - quarter, y: y - quarter },
    { x: x + quarter, y: y - quarter },
    { x: x - quarter, y: y + quarter },
    { x: x + quarter, y: y + quarter },
  ];
}

function pixelOf(png, x, y) {
  const offset = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
}

function colourDistance(first, second) {
  const channels = (color) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  const [firstChannels, secondChannels] = [channels(first), channels(second)];
  return Math.hypot(firstChannels[0] - secondChannels[0], firstChannels[1] - secondChannels[1], firstChannels[2] - secondChannels[2]);
}

/** The whole world, every tile filled with its def's `color` and nothing else. */
function paintWorldByColour(world) {
  const { bounds, defIdRows, tileColours } = world;
  const colourOf = new Map(tileColours.map((def) => [def.id, def.color]));
  const png = new PNG({ width: bounds.width * OVERVIEW_TILE_PIXELS, height: bounds.height * OVERVIEW_TILE_PIXELS });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const color = colourOf.get(defIdRows[Math.floor(y / OVERVIEW_TILE_PIXELS)][Math.floor(x / OVERVIEW_TILE_PIXELS)]) ?? 0;
      png.data.set([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 255], (y * png.width + x) * 4);
    }
  }
  return png;
}

/** Runs in the page: reading the world and walking in it, on top of `window.__novaland`. */
function installWalker() {
  const api = window.__novaland;
  const keyOf = (tile) => `${tile.column},${tile.row}`;
  const nameOfDef = new Map(api.defs.map((def) => [def.id, def.name]));
  const defAt = (tile) => api.defs.find((def) => def.id === api.tileDefIdAt(tile));
  const nameAt = (tile) => nameOfDef.get(api.tileDefIdAt(tile));
  const isWalkable = (tile) => defAt(tile)?.solid === false;
  const sides = (tile) => [
    { column: tile.column + 1, row: tile.row },
    { column: tile.column - 1, row: tile.row },
    { column: tile.column, row: tile.row + 1 },
    { column: tile.column, row: tile.row - 1 },
  ];
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function player() {
    const slot = api.localSlot();
    const entity = api.snapshot().entities.find((candidate) => candidate.components.Player?.slot === slot);
    const def = api.defs.find((candidate) => candidate.id === entity.components.DefRef.id);
    const { x, y } = entity.components.Position;
    return { x, y, radius: def.radius, intent: entity.components.MoveIntent, tile: api.tileAt(x, y), tick: api.sim.tick };
  }

  function move(x, y) {
    api.queueCommand({ type: 'player/move', slot: api.localSlot(), x, y });
  }

  function readWorld() {
    const { bounds } = api.tiles;
    const waterDef = api.defs.find((def) => def.name === 'water');
    const shallowsDef = api.defs.find((def) => def.name === 'shallows');
    const isOfALake = (tile) => api.tileDefIdAt(tile) !== undefined && [waterDef?.id, shallowsDef?.id].includes(api.tileDefIdAt(tile));
    const around = (tile) => [-1, 0, 1].flatMap((rows) => [-1, 0, 1].map((columns) => ({ column: tile.column + columns, row: tile.row + rows })));
    const defIdRows = [];
    const seen = new Set();
    const lakes = [];
    for (let row = bounds.row; row < bounds.row + bounds.height; row += 1) {
      const defIdsOfRow = [];
      for (let column = bounds.column; column < bounds.column + bounds.width; column += 1) {
        const tile = { column, row };
        defIdsOfRow.push(api.tileDefIdAt(tile));
        if (!isOfALake(tile) || seen.has(keyOf(tile))) continue;
        const tiles = [];
        const toVisit = [tile];
        while (toVisit.length > 0) {
          const next = toVisit.pop();
          if (seen.has(keyOf(next)) || !isOfALake(next)) continue;
          seen.add(keyOf(next));
          tiles.push(next);
          toVisit.push(...sides(next));
        }
        const columns = tiles.map((lakeTile) => lakeTile.column);
        const rows = tiles.map((lakeTile) => lakeTile.row);
        const box = { column: Math.min(...columns), row: Math.min(...rows), width: Math.max(...columns) - Math.min(...columns) + 1, height: Math.max(...rows) - Math.min(...rows) + 1 };
        const centre = { column: box.column + Math.floor(box.width / 2), row: box.row + Math.floor(box.height / 2) };
        const area = api.map.areas.find(({ origin, rows: areaRows }) => centre.column >= origin.column && centre.column < origin.column + areaRows[0].length && centre.row >= origin.row && centre.row < origin.row + areaRows.length);
        const tilesFromSpawn = Math.min(...tiles.map((lakeTile) => Math.max(Math.abs(lakeTile.column - api.map.spawn.column), Math.abs(lakeTile.row - api.map.spawn.row))));
        const deep = tiles.filter((lakeTile) => nameAt(lakeTile) === 'water');
        const shallows = tiles.filter((lakeTile) => nameAt(lakeTile) === 'shallows');
        const deepTilesTouchingLand = deep.filter((lakeTile) => around(lakeTile).some((beside) => !isOfALake(beside))).length;
        lakes.push({ area: area?.name ?? 'nowhere', box, tiles, deep, shallows, deepTilesTouchingLand, tilesFromSpawn });
      }
      defIdRows.push(defIdsOfRow);
    }
    const tileColours = api.defs.filter((def) => typeof def.solid === 'boolean').map(({ id, name, color }) => ({ id, name, color }));
    return { water: waterDef, shallows: shallowsDef, lakes, bounds, defIdRows, tileColours, spawn: api.map.spawn };
  }

  /** A walk a person can do with two keys: along the player's row over ground that is walked on, then straight up or down over grass and then shallows into the middle of a stretch of deep water. The shortest one. */
  function keyboardRouteToWater() {
    const from = player().tile;
    let best;
    for (const first of [
      { key: 'D', code: 'KeyD', sign: 1 },
      { key: 'A', code: 'KeyA', sign: -1 },
    ]) {
      for (let column = from.column; isWalkable({ column, row: from.row }); column += first.sign) {
        for (const second of [
          { key: 'S', code: 'KeyS', sign: 1, axis: 'y' },
          { key: 'W', code: 'KeyW', sign: -1, axis: 'y' },
        ]) {
          let row = from.row;
          while (nameAt({ column, row }) === 'grass') row += second.sign;
          while (nameAt({ column, row }) === 'shallows') row += second.sign;
          if (nameAt({ column, row }) !== 'water') continue;
          // Water on both sides of where the player arrives: stopping a little past the column still meets the same shore.
          if (nameAt({ column: column - 1, row }) !== 'water' || nameAt({ column: column + 1, row }) !== 'water') continue;
          const length = Math.abs(column - from.column) + Math.abs(row - from.row);
          if (best && best.length <= length) continue;
          const water = { column, row };
          const centre = api.tileCentre(water);
          best = { length, first, second, turnAt: { column, row: from.row }, turnAtMetres: api.tileCentre({ column, row: from.row }), water, waterFaceMetres: centre.y - (second.sign * api.tiles.tileSize) / 2 };
        }
      }
    }
    return best;
  }

  let lastSettled;
  /** Where the player is, whether it has not moved since the last call a few ticks ago, and what it stands on and faces. */
  function settled() {
    const now = player();
    const still = lastSettled !== undefined && now.tick - lastSettled.tick >= 3 && Math.hypot(now.x - lastSettled.x, now.y - lastSettled.y) < 1e-6 && (now.intent.x !== 0 || now.intent.y !== 0);
    if (lastSettled === undefined || now.tick - lastSettled.tick >= 3) lastSettled = now;
    const ahead = { column: now.tile.column + Math.sign(now.intent.x), row: now.tile.row + Math.sign(now.intent.y) };
    return { ...now, still, standsOn: nameAt(now.tile), tileAhead: nameAt(ahead) };
  }

  /** Walks over walkable tiles to the nearest tile beside the lake's deep water, tile centre to tile centre: a tile of its shallows. */
  async function walkToShoreOf(lake) {
    const water = new Set(lake.deep.map(keyOf));
    const from = player().tile;
    const cameFrom = new Map([[keyOf(from), undefined]]);
    const queue = [from];
    let shore;
    while (queue.length > 0 && !shore) {
      const tile = queue.shift();
      if (sides(tile).some((side) => water.has(keyOf(side)))) shore = tile;
      for (const side of sides(tile)) {
        if (cameFrom.has(keyOf(side)) || !isWalkable(side)) continue;
        cameFrom.set(keyOf(side), tile);
        queue.push(side);
      }
    }
    if (!shore) return { arrived: false, why: 'no walkable way to the edge of its deep water', framesOnSolidTile: 0 };
    const path = [];
    for (let tile = shore; tile; tile = cameFrom.get(keyOf(tile))) path.unshift(tile);
    let framesOnSolidTile = 0;
    let directionSent;
    let framesSinceSent = 0;
    const deadline = Date.now() + 120000;
    for (const waypoint of path) {
      const target = api.tileCentre(waypoint);
      for (;;) {
        const now = player();
        if (!isWalkable(now.tile)) framesOnSolidTile += 1;
        const [eastward, southward] = [target.x - now.x, target.y - now.y];
        if (Math.hypot(eastward, southward) < 0.12) break;
        if (Date.now() > deadline) {
          move(0, 0);
          return { arrived: false, why: `stuck at (${now.x.toFixed(2)}, ${now.y.toFixed(2)}) on the way to tile ${keyOf(waypoint)}`, framesOnSolidTile };
        }
        const direction = `${Math.abs(eastward) > 0.06 ? Math.sign(eastward) : 0},${Math.abs(southward) > 0.06 ? Math.sign(southward) : 0}`;
        // Said again now and then: the sim keeps the last intent it was given, whoever gave it.
        framesSinceSent += 1;
        if (direction !== directionSent || framesSinceSent > 30) {
          directionSent = direction;
          framesSinceSent = 0;
          move(...direction.split(',').map(Number));
        }
        await nextFrame();
      }
    }
    move(0, 0);
    await nextFrame();
    return { arrived: true, steps: path.length - 1, shore, water: sides(shore).find((side) => water.has(keyOf(side))), framesOnSolidTile };
  }

  /** From a tile of the shallows, walks at the deep water tile for a second and a half and says how far that got. */
  async function pushInto(waterTile) {
    const before = player();
    move(Math.sign(waterTile.column - before.tile.column), Math.sign(waterTile.row - before.tile.row));
    while (api.sim.tick - before.tick < 90) await nextFrame();
    const after = player();
    move(0, 0);
    return { standsOn: nameAt(before.tile), endedOn: nameAt(after.tile), movedWhilePushing: Math.hypot(after.x - before.x, after.y - before.y), ticks: after.tick - before.tick };
  }

  /** Where the centre of each of the lake's tiles, and of each grass tile touching it, is on the screen right now, in CSS pixels; and every side of a shallows tile that has grass beyond it. */
  function onScreen(lake) {
    const { zoom, worldView } = api.camera();
    const toScreen = (tile) => {
      const centre = api.tileCentre(tile);
      return { x: (centre.x * api.pixelsPerMetre - worldView.x) * zoom, y: (centre.y * api.pixelsPerMetre - worldView.y) * zoom };
    };
    const inLake = new Set(lake.tiles.map(keyOf));
    // Not the tile the player stands on nor the one above it: they show the player, who is taller than a tile.
    const { tile: playerTile } = player();
    const behindPlayer = new Set([keyOf(playerTile), keyOf({ column: playerTile.column, row: playerTile.row - 1 })]);
    // Nor a tile a tree or a rock leans over: they are drawn taller and wider than their tile, so one beside a tile or in the row below covers part of it.
    const underSomethingStanding = (tile) => [0, 1].some((rows) => [-1, 0, 1].some((columns) => defAt({ column: tile.column + columns, row: tile.row + rows })?.standingSprite !== undefined));
    const inTheOpen = (tile) => !behindPlayer.has(keyOf(tile)) && !underSomethingStanding(tile);
    const beside = new Map();
    const coastSides = [];
    for (const tile of lake.shallows) {
      for (const side of sides(tile)) {
        if (inLake.has(keyOf(side)) || nameAt(side) !== 'grass') continue;
        beside.set(keyOf(side), side);
        // A tree one tile on would lean over the bank: only sides with open grass two tiles deep are looked at.
        const towards = { x: side.column - tile.column, y: side.row - tile.row };
        const further = { column: side.column + towards.x, row: side.row + towards.y };
        const belowSide = { column: side.column, row: side.row + 1 };
        if (inTheOpen(tile) && nameAt(further) === 'grass' && (inLake.has(keyOf(belowSide)) || nameAt(belowSide) === 'grass')) coastSides.push({ tile: toScreen(tile), towards });
      }
    }
    return {
      tilePixels: api.tiles.tileSize * api.pixelsPerMetre * zoom,
      hiddenByPlayer: lake.tiles.filter((tile) => behindPlayer.has(keyOf(tile))).length,
      deep: lake.deep.filter(inTheOpen).map(toScreen),
      shallows: lake.shallows.filter(inTheOpen).map(toScreen),
      coastSides,
      grass: [...beside.values()].filter(inTheOpen).map(toScreen),
    };
  }

  window.__lakes = { readWorld, player, keyboardRouteToWater, settled, walkToShoreOf, pushInto, onScreen };
}
