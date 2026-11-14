/* global window */
/**
 * V3: the level and its art in a real browser. Starts `PORT=<n> pnpm dev`,
 * opens the page in Chromium and proves, from what `window.__novaland` and
 * the screen say:
 *
 * - No paths: the level holds no dirt tile, its outer edge is all trees,
 *   and walking from the spawn over walkable tiles reaches every walkable
 *   tile and never the edge. The spawn is on grass.
 * - Grass: the ground layer's tileset holds the tiles of the served grass
 *   sheet, pixel for pixel; every grass, tree and rock tile shows one of
 *   them; neighbours rarely match; and on screen, every grass tile in view
 *   is exactly the sheet tile the layer says, in flat zoom x zoom blocks.
 * - Rocks: one image of the rock sheet per rock tile, standing on the
 *   tile's bottom edge on grass; on screen it is the sheet's own pixels.
 *   The sim still stops the player at the tile's faces, and the player is
 *   drawn over the rock from the south and never over it from the north.
 * - The same level draws the same way after a reload and at three zooms.
 * - With the two sheets blocked, tiles fall back to flat colours and nothing throws.
 *
 * Expected numbers come from the level grid, the defs and the camera, read
 * through the debug API. Screenshots are the proof.
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { PROOF, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Not 5142: that is the dev server left running for the human. */
const PORT = 5942;
/** CSS pixels; the page opens at a pixel ratio of 1 so screen, device and CSS pixels agree. */
const VIEWPORT = { width: 960, height: 720 };
const OTHER_VIEWPORTS = [
  { width: 640, height: 480 },
  { width: 1920, height: 1080 },
];
const PHASER_NEAREST_SCALE_MODE = 1; // Phaser.ScaleModes.NEAREST
/** The HUD text sits in this corner of the screen, in CSS pixels; pixel checks stay out of it. */
const HUD_CORNER = { width: 460, height: 90 };
const results = [];
const report = { stops: [] };
const errors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const page = await openGame(browser, { onError: (text) => errors.push(text) });

  // ---- Content the expectations are derived from ----
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const tiles = api.defs.filter((def) => typeof def.solid === 'boolean');
    return { grid: api.grid, level: api.level, tiles, pixelsPerMetre: api.pixelsPerMetre, tileCentres: api.grid.defIds.map((defIds, row) => defIds.map((_, column) => api.tileCentre(api.grid, { column, row }))) };
  });
  const { grid, level, tiles } = content;
  const PIXELS_PER_METRE = content.pixelsPerMetre;
  const defNamed = (name) => tiles.find((def) => def.name === name);
  const grass = defNamed('grass');
  const dirt = defNamed('dirt');
  const tree = defNamed('tree');
  const rock = defNamed('rock');
  const defById = new Map(tiles.map((def) => [def.id, def]));
  const defAt = ({ column, row }) => defById.get(grid.defIds[row]?.[column]);
  const tileCentre = ({ column, row }) => content.tileCentres[row][column];
  const half = grid.tileSize / 2;
  const everyTile = grid.defIds.flatMap((defIds, row) => defIds.map((defId, column) => ({ column, row, defId })));
  const tilesOf = (def) => everyTile.filter((tile) => tile.defId === def.id);
  report.content = { grass, rock, tiles: Object.fromEntries(tiles.map((def) => [def.name, tilesOf(def).length])), spawn: level.spawn };

  // ---- No rule changes ----
  results.push(check('the defs are unchanged for the sim: grass 200 walkable, dirt 201 walkable, tree 202 solid, rock 203 solid', grass.id === 200 && !grass.solid && dirt.id === 201 && !dirt.solid && tree.id === 202 && tree.solid && rock.id === 203 && rock.solid));

  // ---- No paths, closed ring ----
  results.push(check('the level holds no dirt tile', tilesOf(dirt).length === 0, `${tilesOf(dirt).length} dirt tiles`));
  results.push(check('the level legend no longer maps a character to dirt', !Object.values(level.legend).includes(dirt.id), JSON.stringify(level.legend)));
  results.push(check('every tile of the level is grass, a tree or a rock', everyTile.every((tile) => [grass.id, tree.id, rock.id].includes(tile.defId)), JSON.stringify(report.content.tiles)));
  const onTheEdge = ({ column, row }) => column === 0 || row === 0 || column === grid.columns - 1 || row === grid.rows - 1;
  results.push(check('the outer edge of the level is trees all the way round', everyTile.filter(onTheEdge).every((tile) => tile.defId === tree.id), `${everyTile.filter(onTheEdge).length} edge tiles`));
  const reachable = walkableTilesReachableFrom(level.spawn, { grid, defAt });
  const walkable = everyTile.filter((tile) => !defById.get(tile.defId).solid);
  results.push(check('the spawn is on a grass tile', defAt(level.spawn) === grass, JSON.stringify(level.spawn)));
  results.push(check('walking from the spawn never reaches the edge of the level: the ring of trees is closed', reachable.length > 0 && !reachable.some(onTheEdge), `${reachable.length} tiles reached`));
  results.push(check('every walkable tile can be reached from the spawn', reachable.length === walkable.length, `${reachable.length} of ${walkable.length}`));
  results.push(check('where the old path left the clearing at the top (row 2, columns 20-21) there are trees now', defAt({ column: 20, row: 2 }) === tree && defAt({ column: 21, row: 2 }) === tree));

  // ---- The sheets, as served and as Phaser holds them ----
  const GRASS = grass.groundSprite;
  const ROCK = rock.standingSprite;
  results.push(check('the grass def carries a ground sprite and no standing sprite', GRASS && GRASS.key === 'grass' && grass.standingSprite === undefined, JSON.stringify(GRASS)));
  results.push(check('the rock def carries a standing sprite that stands on grass', ROCK && ROCK.key === 'rock' && ROCK.groundDefId === grass.id && tree.standingSprite.groundDefId === grass.id, JSON.stringify(ROCK)));
  const grassSheet = await servedPng(page, `sprites/${GRASS.key}.png`);
  const rockSheet = await servedPng(page, `sprites/${ROCK.key}.png`);
  results.push(check('the grass sheet is served as a PNG of `variantCount` square tiles side by side', grassSheet.ok && grassSheet.png.width === GRASS.tilePixels * GRASS.variantCount && grassSheet.png.height === GRASS.tilePixels, `${grassSheet.png.width}x${grassSheet.png.height}`));
  results.push(check('the rock sheet is served as a PNG of `variantCount` frames side by side', rockSheet.ok && rockSheet.png.width === ROCK.frameWidth * ROCK.variantCount && rockSheet.png.height === ROCK.frameHeight, `${rockSheet.png.width}x${rockSheet.png.height}`));

  /** Where each def's tiles start in the ground tileset: def order, a run of variants for a ground sprite, one tile otherwise. */
  const firstTileIndexOf = new Map();
  let nextTileIndex = 0;
  for (const def of tiles) {
    firstTileIndexOf.set(def.id, nextTileIndex);
    nextTileIndex += def.groundSprite ? def.groundSprite.variantCount : 1;
  }
  const grassFirst = firstTileIndexOf.get(grass.id);

  const drawn = await drawnTerrain(page, { rockKey: ROCK.key, treeKey: tree.standingSprite.key });
  report.drawn = { tileset: { ...drawn.tileset, pixels: undefined }, rocks: drawn.rocks.length, trees: drawn.trees.length };
  results.push(check('the ground is one tilemap layer below every image and the player', drawn.terrain.drawIndex === 0 && [...drawn.rocks, ...drawn.trees].every((image) => image.depth > drawn.terrain.depth) && drawn.sprite.depth > drawn.terrain.depth));
  results.push(check('its tileset has one tile per grass variant and one per other def, drawn with nearest-neighbour filtering', drawn.tileset.width === nextTileIndex * GRASS.tilePixels && drawn.tileset.height === GRASS.tilePixels && drawn.tileset.scaleMode === PHASER_NEAREST_SCALE_MODE, `${drawn.tileset.width}x${drawn.tileset.height}, scaleMode ${drawn.tileset.scaleMode}`));
  const tilesetGrassWrong = differingPixels({ first: { data: drawn.tileset.pixels, width: drawn.tileset.width }, firstLeft: grassFirst * GRASS.tilePixels, second: grassSheet.png, secondLeft: 0, width: GRASS.tilePixels * GRASS.variantCount, height: GRASS.tilePixels });
  results.push(check("the grass tiles of the tileset are the served grass sheet's pixels, one for one", tilesetGrassWrong === 0, `${tilesetGrassWrong} of ${GRASS.tilePixels * GRASS.tilePixels * GRASS.variantCount} pixels differ`));

  // ---- Grass under everything ----
  const variantAt = ({ column, row }) => drawn.terrain.tileIndexRows[row][column] - grassFirst;
  const showsGrass = (tile) => Number.isInteger(variantAt(tile)) && variantAt(tile) >= 0 && variantAt(tile) < GRASS.variantCount;
  results.push(check('every grass tile shows a tile of the grass sheet', tilesOf(grass).every(showsGrass), `${tilesOf(grass).length} grass tiles`));
  results.push(check('the ground under every tree and every rock is a tile of the grass sheet too', [...tilesOf(tree), ...tilesOf(rock)].every(showsGrass), `${tilesOf(tree).length} trees, ${tilesOf(rock).length} rocks`));
  const variantsUsed = new Set(everyTile.map(variantAt));
  results.push(check('every variant of the grass sheet is used somewhere in the level', variantsUsed.size === GRASS.variantCount, `${variantsUsed.size} of ${GRASS.variantCount}`));
  const neighbourPairs = everyTile.flatMap((tile) => [{ column: tile.column + 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }].filter((other) => defAt(other)).map((other) => [tile, other]));
  const matchingNeighbours = neighbourPairs.filter(([first, second]) => variantAt(first) === variantAt(second)).length;
  results.push(check('a field does not repeat: fewer than one in ten neighbouring tiles show the same variant', matchingNeighbours / neighbourPairs.length < 0.1, `${matchingNeighbours} of ${neighbourPairs.length} pairs`));
  const longestRun = Math.max(...drawn.terrain.tileIndexRows.map(longestRunOfEqual), ...transposed(drawn.terrain.tileIndexRows).map(longestRunOfEqual));
  results.push(check('no row or column shows the same variant more than three tiles running', longestRun <= 3, `longest run ${longestRun}`));

  // ---- One rock image per rock tile ----
  const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
  const rockImageAt = (sample, tile) => sample.rocks.find((image) => near(image.x, tileCentre(tile).x * PIXELS_PER_METRE) && near(image.y, (tileCentre(tile).y + half) * PIXELS_PER_METRE));
  results.push(check(`there is one rock image per rock tile (${tilesOf(rock).length})`, drawn.rocks.length === tilesOf(rock).length && tilesOf(rock).every((tile) => rockImageAt(drawn, tile)), `${drawn.rocks.length} images`));
  results.push(check("every rock image stands on its tile's bottom centre and is sorted by that bottom edge", drawn.rocks.every((image) => image.originX === 0.5 && image.originY === 1 && image.depth === image.y)));
  results.push(check('every rock image is drawn at one texture pixel per world pixel, on whole pixels, inside the width of its tile', drawn.rocks.every((image) => image.scaleX === PIXELS_PER_METRE / ROCK.pixelsPerMetre && image.scaleY === image.scaleX && image.width === ROCK.frameWidth && image.height === ROCK.frameHeight && image.width <= grid.tileSize * PIXELS_PER_METRE && Number.isInteger(image.x - image.width / 2) && Number.isInteger(image.y))));
  const rockVariantsUsed = new Set(drawn.rocks.map((image) => image.frame));
  results.push(check('the rocks of the level show more than one variant, all of them frames of the sheet', rockVariantsUsed.size >= 2 && [...rockVariantsUsed].every((frame) => Number.isInteger(frame) && frame >= 0 && frame < ROCK.variantCount), `variants ${[...rockVariantsUsed].sort().join(', ')} of ${ROCK.variantCount}`));
  results.push(check('the rock sheet is drawn with nearest-neighbour filtering', drawn.rockTexture.exists && drawn.rockTexture.frames === ROCK.variantCount && drawn.rockTexture.scaleMode === PHASER_NEAREST_SCALE_MODE, `${drawn.rockTexture.frames} frames, scaleMode ${drawn.rockTexture.scaleMode}`));

  // ---- On screen at the spawn: the pixels are the sheets' ----
  const state = () => drawnTerrain(page, { rockKey: ROCK.key, treeKey: tree.standingSprite.key, withTileset: false });
  const atSpawn = await state();
  const spawnScreenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, '03-browser-1-at-spawn.png') }));
  const spawnPixels = pixelsOnScreen({ sample: atSpawn, screenshot: spawnScreenshot });
  report.atSpawn = spawnPixels;
  results.push(check('at the spawn: every grass tile in view is, pixel for pixel, the sheet tile the layer says', spawnPixels.grassTilesChecked >= 100 && spawnPixels.grassPixelsWrong === 0, `${spawnPixels.grassTilesChecked} tiles, ${spawnPixels.grassPixelsCompared} pixels, ${spawnPixels.grassPixelsWrong} wrong`));
  results.push(check('at the spawn: the grass in view is textured, not a flat fill: several greens in every tile', spawnPixels.fewestColoursInAGrassTile >= 3, `fewest colours in a tile: ${spawnPixels.fewestColoursInAGrassTile}`));
  results.push(check("at the spawn: every rock in view shows the rock sheet's own pixels", spawnPixels.rocksChecked >= 1 && spawnPixels.rockPixelsWrong === 0, `${spawnPixels.rocksChecked} rocks, ${spawnPixels.rockPixelsCompared} pixels, ${spawnPixels.rockPixelsWrong} wrong`));

  // ---- The rock still stops the player, and sorts against it ----
  const walkUntil = async (key, arrived, timeoutMs = 8000) => {
    await page.keyboard.down(key);
    const deadline = Date.now() + timeoutMs;
    let reached = false;
    while (Date.now() < deadline && !(reached = arrived(await playerOf(page)))) await page.waitForTimeout(10);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
    return reached;
  };
  const push = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
  };
  const tileUnder = ({ x, y }) => ({ column: Math.floor((x + grid.width / 2) / grid.tileSize), row: Math.floor((y + grid.height / 2) / grid.tileSize) });
  /** Walks tile by tile along a route that keeps a tile of clearance from anything solid. */
  const walkTo = async (target) => {
    const route = routeBetween(tileUnder(await playerOf(page)), target, { grid, defAt });
    if (!route) return false;
    let from = route[0];
    for (const tile of route.slice(1)) {
      const centre = tileCentre(tile);
      const [key, arrived] = tile.column > from.column ? ['KeyD', (player) => player.x >= centre.x] : tile.column < from.column ? ['KeyA', (player) => player.x <= centre.x] : tile.row > from.row ? ['KeyS', (player) => player.y >= centre.y] : ['KeyW', (player) => player.y <= centre.y];
      if (!(await walkUntil(key, arrived))) return false;
      from = tile;
    }
    return true;
  };
  const RADIUS = (await playerOf(page)).halfHeight;
  const spawnCentre = tileCentre(level.spawn);
  const openRock = tilesOf(rock)
    .filter((tile) => neighbourhoodOf(tile, 2).every((other) => (other.column === tile.column && other.row === tile.row) || defAt(other) === grass))
    .sort((first, second) => Math.hypot(tileCentre(first).x - spawnCentre.x, tileCentre(first).y - spawnCentre.y) - Math.hypot(tileCentre(second).x - spawnCentre.x, tileCentre(second).y - spawnCentre.y))[0];
  report.openRock = openRock;
  results.push(check('the level has a rock with open grass two tiles around it to walk around', openRock !== undefined, JSON.stringify(openRock)));
  if (openRock) {
    const rockCentre = tileCentre(openRock);
    const recordStop = async (name, relationExpected) => {
      const sample = await state();
      const screenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, `03-browser-${name}.png`) }));
      const image = rockImageAt(sample, openRock);
      const overlap = rockPixelsUnderThePlayer({ sample, screenshot, image });
      await closeUp(page, { name: `03-browser-${name}-close-up.png`, sample, centre: rockCentre, pixelsPerMetre: PIXELS_PER_METRE });
      const relation = sample.sprite.depth > image.depth ? 'in front of' : 'behind';
      report.stops.push({ name, player: sample.player, spriteDepth: sample.sprite.depth, rockDepth: image.depth, relation, overlap });
      results.push(check(`${name}: the player is drawn ${relationExpected} the rock, as their bottom edges say`, relation === relationExpected && sample.sprite.drawIndex > image.drawIndex === (relationExpected === 'in front of'), `sprite depth ${sample.sprite.depth.toFixed(1)}, rock depth ${image.depth}`));
      return { sample, overlap };
    };

    results.push(check('walked to two tiles south of the rock', await walkTo({ column: openRock.column, row: openRock.row + 2 })));
    await push('KeyW', 1200);
    const inFront = await recordStop('2-in-front-of-a-rock', 'in front of');
    results.push(check('2-in-front-of-a-rock: the sim stopped the player at the south face of the rock tile, as before', near(inFront.sample.player.y, rockCentre.y + half + RADIUS, 0.05) && Math.abs(inFront.sample.player.x - rockCentre.x) < half, `y=${inFront.sample.player.y.toFixed(3)}, face + radius at ${(rockCentre.y + half + RADIUS).toFixed(3)}`));
    results.push(check('2-in-front-of-a-rock: on screen the player covers part of the rock', inFront.overlap.rockPixelsUnderTheSprite > 0 && inFront.overlap.showingSomethingElse > 0, JSON.stringify(inFront.overlap)));

    results.push(check('walked round to two tiles north of the rock', await walkTo({ column: openRock.column, row: openRock.row - 2 })));
    await push('KeyS', 1200);
    const behind = await recordStop('3-behind-a-rock', 'behind');
    results.push(check('3-behind-a-rock: the sim stopped the player at the north face of the rock tile, as before', near(behind.sample.player.y, rockCentre.y - half - RADIUS, 0.05) && Math.abs(behind.sample.player.x - rockCentre.x) < half, `y=${behind.sample.player.y.toFixed(3)}, face - radius at ${(rockCentre.y - half - RADIUS).toFixed(3)}`));
    // Most rock variants end at the top edge of their tile, so from the north the sprite may not reach the rock at all.
    results.push(check('3-behind-a-rock: on screen the player covers no pixel of the rock', behind.overlap.showingSomethingElse === 0, JSON.stringify(behind.overlap)));
  }

  // ---- Where the paths crossed: grass ----
  const oldCrossroads = { column: 20, row: 14 };
  results.push(check('walked to where the two main paths used to cross', await walkTo(oldCrossroads)));
  const atCrossroads = await state();
  const crossroadsScreenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, '03-browser-4-where-the-paths-crossed.png') }));
  const crossroadsPixels = pixelsOnScreen({ sample: atCrossroads, screenshot: crossroadsScreenshot });
  const dirtColour = [(dirt.color >> 16) & 0xff, (dirt.color >> 8) & 0xff, dirt.color & 0xff].join(',');
  results.push(check('there, every ground tile in view is a grass sheet tile, pixel for pixel, and nothing is dirt-coloured', crossroadsPixels.grassTilesChecked >= 100 && crossroadsPixels.grassPixelsWrong === 0 && coloursOf(crossroadsScreenshot).get(dirtColour) === undefined, `${crossroadsPixels.grassTilesChecked} tiles checked, ${coloursOf(crossroadsScreenshot).get(dirtColour) ?? 0} dirt-coloured pixels`));

  // ---- Crisp at every whole-number zoom ----
  const zooms = [];
  for (const viewport of [VIEWPORT, ...OTHER_VIEWPORTS]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction((width) => window.__novaland.camera().width === width, viewport.width, { timeout: 5000 });
    await page.waitForTimeout(300);
    const sample = await state();
    const screenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, `03-browser-5-zoom-${sample.camera.zoom}x.png`) }));
    const pixels = pixelsOnScreen({ sample, screenshot });
    zooms.push({ viewport, zoom: sample.camera.zoom, ...pixels });
    results.push(check(`${viewport.width}x${viewport.height}: the camera zoom is a whole number`, Number.isInteger(sample.camera.zoom) && sample.camera.zoom >= 1, `zoom ${sample.camera.zoom}`));
    results.push(check(`${viewport.width}x${viewport.height}: every texture pixel of the grass and rocks checked is one flat ${sample.camera.zoom}x${sample.camera.zoom} block in the sheet's own colour`, pixels.grassTilesChecked >= 20 && pixels.grassPixelsWrong === 0 && pixels.rockPixelsWrong === 0 && pixels.blocksNotFlat === 0, `${pixels.grassTilesChecked} grass tiles, ${pixels.rocksChecked} rocks, ${pixels.blocksNotFlat} blocks not flat`));
  }
  report.zooms = zooms;
  results.push(check('the art was checked at more than one zoom', new Set(zooms.map((entry) => entry.zoom)).size >= 2, zooms.map((entry) => `${entry.zoom}x`).join(', ')));
  results.push(check('a rock was on screen at one zoom at least', zooms.some((entry) => entry.rocksChecked >= 1), zooms.map((entry) => entry.rocksChecked).join(', ')));

  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;

  // ---- The same level draws the same way on a reload and for another player ----
  const otherPage = await openGame(browser, { onError: () => {} });
  const drawnAgain = await drawnTerrain(otherPage, { rockKey: ROCK.key, treeKey: tree.standingSprite.key });
  const framesOf = (sample) => [...sample.rocks, ...sample.trees].map((image) => `${image.x},${image.y},${image.frame}`).sort().join(' ');
  results.push(check('a second page shows every tile in the same grass variant', JSON.stringify(drawnAgain.terrain.tileIndexRows) === JSON.stringify(drawn.terrain.tileIndexRows)));
  results.push(check('a second page shows every rock and tree in the same variant', framesOf(drawnAgain) === framesOf(drawn)));
  await otherPage.reload();
  await otherPage.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.camera(), null, { timeout: 15000 });
  const drawnAfterReload = await drawnTerrain(otherPage, { rockKey: ROCK.key, treeKey: tree.standingSprite.key });
  results.push(check('after a reload the ground and the standing images are the same again', JSON.stringify(drawnAfterReload.terrain.tileIndexRows) === JSON.stringify(drawn.terrain.tileIndexRows) && framesOf(drawnAfterReload) === framesOf(drawn)));
  await otherPage.close();

  // ---- Without the sheets, tiles fall back to flat colours and the game still runs ----
  const crashes = [];
  const pageWithoutTheSheets = await openGame(browser, { onPageError: (text) => crashes.push(text), blocked: [`**/sprites/${GRASS.key}.png`, `**/sprites/${ROCK.key}.png`] });
  const withoutTheSheets = await drawnTerrain(pageWithoutTheSheets, { rockKey: ROCK.key, treeKey: tree.standingSprite.key, withTileset: false });
  const fallbackScreenshot = PNG.sync.read(await pageWithoutTheSheets.screenshot({ path: path.join(PROOF, '03-browser-6-without-the-sheets.png') }));
  const flatIndexOf = (defId) => tiles.findIndex((def) => def.id === defId);
  const flatAsExpected = everyTile.every((tile) => withoutTheSheets.terrain.tileIndexRows[tile.row][tile.column] === flatIndexOf(tile.defId === tree.id ? grass.id : tile.defId));
  const grassColour = [(grass.color >> 16) & 0xff, (grass.color >> 8) & 0xff, grass.color & 0xff].join(',');
  const rockColour = [(rock.color >> 16) & 0xff, (rock.color >> 8) & 0xff, rock.color & 0xff].join(',');
  report.withoutTheSheets = { rocks: withoutTheSheets.rocks.length, trees: withoutTheSheets.trees.length, crashes };
  results.push(check('without the sheets: no rock image is drawn, and the trees still are', withoutTheSheets.rocks.length === 0 && withoutTheSheets.trees.length === tilesOf(tree).length, `${withoutTheSheets.rocks.length} rock images, ${withoutTheSheets.trees.length} tree images`));
  results.push(check("without the sheets: grass and rocks are each drawn as the flat tile of their own def, grass still under the trees", flatAsExpected));
  results.push(check('without the sheets: the screen shows the flat grass and rock colours', (coloursOf(fallbackScreenshot).get(grassColour) ?? 0) > 10000 && (coloursOf(fallbackScreenshot).get(rockColour) ?? 0) > 100, `${coloursOf(fallbackScreenshot).get(grassColour) ?? 0} grass-coloured pixels, ${coloursOf(fallbackScreenshot).get(rockColour) ?? 0} rock-coloured`));
  results.push(check('without the sheets: the game runs and nothing throws', withoutTheSheets.tick > 10 && crashes.length === 0, crashes.join(' | ').slice(0, 200)));

  // ---- Helpers that need the content read above ----

  /**
   * Compares the screenshot with the sheets. For every grass-showing tile fully in view, away from the HUD corner and
   * not under any image or the player: each texture pixel must be one flat zoom x zoom block in the colour of the
   * sheet tile the layer names. For every rock image fully in view that nothing else overlaps: the same for each
   * opaque pixel of its frame.
   */
  function pixelsOnScreen({ sample, screenshot }) {
    const { zoom, worldView } = sample.camera;
    const screenOf = (worldX, worldY) => ({ x: Math.round((worldX - worldView.x) * zoom), y: Math.round((worldY - worldView.y) * zoom) });
    const inView = ({ left, top, right, bottom }) => left >= 0 && top >= 0 && right <= screenshot.width && bottom <= screenshot.height && !(left < HUD_CORNER.width && top < HUD_CORNER.height);
    const covering = [...sample.rocks, ...sample.trees, sample.sprite].map(rectangleOf);
    const summary = { grassTilesChecked: 0, grassPixelsCompared: 0, grassPixelsWrong: 0, fewestColoursInAGrassTile: Infinity, rocksChecked: 0, rockPixelsCompared: 0, rockPixelsWrong: 0, blocksNotFlat: 0 };
    /** The colour of the zoom x zoom block at this screen position, or undefined when the block is not one colour. */
    const blockAt = (screenX, screenY) => {
      const colour = rgbaAt(screenshot, screenX, screenY).colour;
      for (let dy = 0; dy < zoom; dy += 1) {
        for (let dx = 0; dx < zoom; dx += 1) if (rgbaAt(screenshot, screenX + dx, screenY + dy).colour !== colour) return undefined;
      }
      return colour;
    };
    for (const tile of everyTile) {
      const centre = tileCentre(tile);
      const world = { left: (centre.x - half) * PIXELS_PER_METRE, top: (centre.y - half) * PIXELS_PER_METRE, right: (centre.x + half) * PIXELS_PER_METRE, bottom: (centre.y + half) * PIXELS_PER_METRE };
      const corner = screenOf(world.left, world.top);
      const side = GRASS.tilePixels * zoom;
      if (!inView({ left: corner.x, top: corner.y, right: corner.x + side, bottom: corner.y + side })) continue;
      if (covering.some((rectangle) => overlaps(rectangle, world))) continue;
      const variant = sample.terrain.tileIndexRows[tile.row][tile.column] - grassFirst;
      const colours = new Set();
      summary.grassTilesChecked += 1;
      for (let y = 0; y < GRASS.tilePixels; y += 1) {
        for (let x = 0; x < GRASS.tilePixels; x += 1) {
          const block = blockAt(corner.x + x * zoom, corner.y + y * zoom);
          summary.grassPixelsCompared += 1;
          if (block === undefined) summary.blocksNotFlat += 1;
          if (block !== rgbaAt(grassSheet.png, variant * GRASS.tilePixels + x, y).colour) summary.grassPixelsWrong += 1;
          colours.add(block);
        }
      }
      summary.fewestColoursInAGrassTile = Math.min(summary.fewestColoursInAGrassTile, colours.size);
    }
    for (const image of sample.rocks) {
      const world = rectangleOf(image);
      const corner = screenOf(world.left, world.top);
      if (!inView({ left: corner.x, top: corner.y, right: corner.x + image.width * zoom, bottom: corner.y + image.height * zoom })) continue;
      if ([...sample.rocks, ...sample.trees, sample.sprite].some((other) => other !== image && overlaps(rectangleOf(other), world))) continue;
      summary.rocksChecked += 1;
      for (let y = 0; y < ROCK.frameHeight; y += 1) {
        for (let x = 0; x < ROCK.frameWidth; x += 1) {
          const sheetPixel = rgbaAt(rockSheet.png, image.frame * ROCK.frameWidth + x, y);
          if (sheetPixel.alpha !== 255) continue;
          const block = blockAt(corner.x + x * zoom, corner.y + y * zoom);
          summary.rockPixelsCompared += 1;
          if (block === undefined) summary.blocksNotFlat += 1;
          if (block !== sheetPixel.colour) summary.rockPixelsWrong += 1;
        }
      }
    }
    return summary;
  }

  /** Of the opaque rock pixels that lie under the player's sprite rectangle: how many show the rock on screen and how many something else (the player). */
  function rockPixelsUnderThePlayer({ sample, screenshot, image }) {
    const { zoom, worldView } = sample.camera;
    const rockRectangle = rectangleOf(image);
    const spriteRectangle = rectangleOf(sample.sprite);
    const summary = { rockPixelsUnderTheSprite: 0, showingTheRock: 0, showingSomethingElse: 0 };
    for (let y = 0; y < ROCK.frameHeight; y += 1) {
      for (let x = 0; x < ROCK.frameWidth; x += 1) {
        const sheetPixel = rgbaAt(rockSheet.png, image.frame * ROCK.frameWidth + x, y);
        const worldX = rockRectangle.left + x;
        const worldY = rockRectangle.top + y;
        if (sheetPixel.alpha !== 255 || worldX < spriteRectangle.left || worldX >= spriteRectangle.right || worldY < spriteRectangle.top || worldY >= spriteRectangle.bottom) continue;
        summary.rockPixelsUnderTheSprite += 1;
        const onScreen = rgbaAt(screenshot, Math.round((worldX - worldView.x) * zoom), Math.round((worldY - worldView.y) * zoom)).colour;
        if (onScreen === sheetPixel.colour) summary.showingTheRock += 1;
        else summary.showingSomethingElse += 1;
      }
    }
    return summary;
  }

  function neighbourhoodOf(tile, reach) {
    const around = [];
    for (let row = tile.row - reach; row <= tile.row + reach; row += 1) {
      for (let column = tile.column - reach; column <= tile.column + reach; column += 1) around.push({ column, row });
    }
    return around;
  }
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** A page with the game running in it. `blocked` are URL patterns whose requests fail, as if the files were missing. */
async function openGame(browser, { onError, onPageError, blocked = [] }) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => (onPageError ?? onError)(String(error)));
  if (onError) page.on('console', (message) => message.type() === 'error' && onError(message.text()));
  for (const pattern of blocked) await page.route(pattern, (route) => route.abort());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.camera(), null, { timeout: 15000 });
  return page;
}

/** The local player's body as the sim has it, in metres. */
function playerOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const { Position, Extents } = api.snapshot().entities.find((entity) => entity.components.Player?.slot === api.localSlot()).components;
    return { x: Position.x, y: Position.y, halfHeight: Extents.halfHeight };
  });
}

/** What the world scene draws right now: the ground layer and its tileset, every rock and tree image, the player's sprite, and the camera. */
function drawnTerrain(page, { rockKey, treeKey, withTileset = true }) {
  return page.evaluate(
    ({ rockKey, treeKey, withTileset }) => {
      const api = window.__novaland;
      const objects = api.game.scene.getScene('world').children.list;
      const terrain = objects.find((object) => object.type === 'TilemapLayer');
      const drawnObject = (object) => ({ drawIndex: objects.indexOf(object), x: object.x, y: object.y, depth: object.depth, frame: Number(object.frame.name), originX: object.originX, originY: object.originY, scaleX: object.scaleX, scaleY: object.scaleY, width: object.displayWidth, height: object.displayHeight });
      const imagesOf = (key) => objects.filter((object) => object.type === 'Image' && object.texture.key === key).map(drawnObject);
      const tilesetTexture = api.game.textures.get(terrain.tileset[0].image.key);
      const tilesetCanvas = tilesetTexture.getSourceImage();
      const rockTextureExists = api.game.textures.exists(rockKey);
      const { Position, Extents } = api.snapshot().entities.find((entity) => entity.components.Player?.slot === api.localSlot()).components;
      return {
        tick: api.sim.tick,
        camera: api.camera(),
        player: { x: Position.x, y: Position.y, halfHeight: Extents.halfHeight },
        sprite: drawnObject(objects.find((object) => object.type === 'Sprite')),
        rocks: imagesOf(rockKey),
        trees: imagesOf(treeKey),
        rockTexture: rockTextureExists ? { exists: true, frames: api.game.textures.get(rockKey).frameTotal - 1, scaleMode: api.game.textures.get(rockKey).source[0].scaleMode } : { exists: false },
        terrain: { drawIndex: objects.indexOf(terrain), depth: terrain.depth, tileIndexRows: terrain.layer.data.map((row) => row.map((tile) => tile.index)) },
        tileset: {
          width: tilesetCanvas.width,
          height: tilesetCanvas.height,
          scaleMode: tilesetTexture.source[0].scaleMode,
          pixels: withTileset ? Array.from(tilesetCanvas.getContext('2d').getImageData(0, 0, tilesetCanvas.width, tilesetCanvas.height).data) : undefined,
        },
      };
    },
    { rockKey, treeKey, withTileset },
  );
}

async function servedPng(page, relativeUrl) {
  const response = await page.request.get(`http://localhost:${PORT}/${relativeUrl}`);
  const contentType = response.headers()['content-type'] ?? '';
  const ok = response.status() === 200 && contentType.includes('image/png');
  return { ok, status: response.status(), contentType, png: ok ? PNG.sync.read(await response.body()) : { width: 0, height: 0, data: Buffer.alloc(0) } };
}

function rgbaAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return { colour: 'outside', alpha: 0 };
  const offset = (y * png.width + x) * 4;
  return { colour: `${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]}`, alpha: png.data[offset + 3] };
}

/** How many pixels differ (colour or alpha) between two strips of the same size, one in each image. */
function differingPixels({ first, firstLeft, second, secondLeft, width, height }) {
  let differing = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const firstOffset = (y * first.width + firstLeft + x) * 4;
      const secondOffset = (y * second.width + secondLeft + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (first.data[firstOffset + channel] !== second.data[secondOffset + channel]) {
          differing += 1;
          break;
        }
      }
    }
  }
  return differing;
}

/** How many pixels of an image have each colour. */
function coloursOf(png) {
  const counts = new Map();
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const colour = `${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]}`;
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  return counts;
}

function overlaps(first, second) {
  return first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;
}

/** The world pixels a drawn object covers. */
function rectangleOf(image) {
  return { left: image.x - image.width * image.originX, top: image.y - image.height * image.originY, right: image.x + image.width * (1 - image.originX), bottom: image.y + image.height * (1 - image.originY) };
}

function longestRunOfEqual(values) {
  let longest = 0;
  let run = 0;
  values.forEach((value, index) => {
    run = index > 0 && value === values[index - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}

function transposed(rows) {
  return rows[0].map((_, column) => rows.map((row) => row[column]));
}

/** Every walkable tile that can be reached from `start` by stepping to a walkable neighbour up, down, left or right. */
function walkableTilesReachableFrom(start, { defAt }) {
  const reached = new Map();
  const toVisit = [start];
  while (toVisit.length > 0) {
    const tile = toVisit.pop();
    const key = `${tile.column},${tile.row}`;
    const def = defAt(tile);
    if (reached.has(key) || !def || def.solid) continue;
    reached.set(key, tile);
    toVisit.push({ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 });
  }
  return [...reached.values()];
}

/**
 * The shortest way from one tile to another in steps up, down, left and right, over walkable tiles that have no
 * solid tile next to them, corners included (the two ends may), so that a player who overshoots a tile centre by a
 * little never clips a corner. Undefined when there is none.
 */
function routeBetween(from, to, { defAt }) {
  const keyOf = (tile) => `${tile.column},${tile.row}`;
  const isEnd = (tile) => keyOf(tile) === keyOf(from) || keyOf(tile) === keyOf(to);
  const isClear = (tile) => {
    const def = defAt(tile);
    if (!def || def.solid) return false;
    if (isEnd(tile)) return true;
    for (let row = tile.row - 1; row <= tile.row + 1; row += 1) {
      for (let column = tile.column - 1; column <= tile.column + 1; column += 1) if (defAt({ column, row })?.solid !== false) return false;
    }
    return true;
  };
  const cameFrom = new Map([[keyOf(from), undefined]]);
  const queue = [from];
  while (queue.length > 0) {
    const tile = queue.shift();
    if (keyOf(tile) === keyOf(to)) {
      const route = [];
      for (let step = tile; step; step = cameFrom.get(keyOf(step))) route.unshift(step);
      return route;
    }
    for (const next of [{ column: tile.column + 1, row: tile.row }, { column: tile.column - 1, row: tile.row }, { column: tile.column, row: tile.row + 1 }, { column: tile.column, row: tile.row - 1 }]) {
      if (cameFrom.has(keyOf(next)) || !isClear(next)) continue;
      cameFrom.set(keyOf(next), tile);
      queue.push(next);
    }
  }
  return undefined;
}

/** A screenshot of a few metres around a point, for the proof folder. */
async function closeUp(page, { name, sample, centre, pixelsPerMetre, sizeMetres = 5 }) {
  const { zoom, worldView, width: screenWidth, height: screenHeight } = sample.camera;
  const side = sizeMetres * pixelsPerMetre * zoom;
  const x = Math.max(0, Math.min(Math.round((centre.x * pixelsPerMetre - worldView.x) * zoom - side / 2), screenWidth - side));
  const y = Math.max(0, Math.min(Math.round((centre.y * pixelsPerMetre - worldView.y) * zoom - side / 2), screenHeight - side));
  await page.screenshot({ path: path.join(PROOF, name), clip: { x, y, width: side, height: side } });
}
