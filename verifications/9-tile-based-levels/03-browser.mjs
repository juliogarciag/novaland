/* global window */
/**
 * V3: the tile level in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium and checks, through window.__novaland and the Phaser scene, that the
 * level is drawn as a tilemap matching the sim's grid cell for cell, that the
 * player spawns on a dirt path, walks along it with real key presses, and is
 * stopped by trees where the grid says the trees are. Screenshots are the proof.
 * Every expectation is derived from the level and defs, never typed here.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5309;
const results = [];
const report = { steps: [] };
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  results.push(check('dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });

  // Content the expectations are derived from.
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const player = api.defs.find((d) => d.name === 'player');
    const tiles = api.defs.filter((d) => typeof d.solid === 'boolean');
    return { level: api.level, grid: api.grid, tiles, speed: player.speed, radius: player.radius, ppm: api.pixelsPerMetre };
  });
  const { level, grid, tiles, speed: SPEED, radius: RADIUS, ppm: PPM } = content;
  const tileByName = (name) => tiles.find((t) => t.name === name);
  const defAt = (column, row) => tiles.find((t) => t.id === grid.defIds[row][column]);
  const tileOf = (x, y) => ({ column: Math.floor((x + grid.width / 2) / grid.tileSize), row: Math.floor((y + grid.height / 2) / grid.tileSize) });
  const tileTop = (row) => row * grid.tileSize - grid.height / 2;
  const tileBottom = (row) => tileTop(row + 1);
  report.content = { grid: { columns: grid.columns, rows: grid.rows, tileSize: grid.tileSize }, tiles: tiles.map((t) => t.name), spawn: level.spawn, SPEED, RADIUS, PPM };

  /** Sim state, the drawn player and the drawn tile under it, read in the same frame. */
  const state = () =>
    page.evaluate(() => {
      const api = window.__novaland;
      const s = api.snapshot();
      const p = s.entities.find((e) => e.components.Player);
      const scene = api.game.scene.getScene('world');
      const circle = scene.children.list.find((o) => o.type === 'Arc');
      const layer = scene.children.list.find((o) => o.type === 'TilemapLayer');
      const x = p.components.Position.x;
      const y = p.components.Position.y;
      const under = layer.getTileAtWorldXY(x * api.pixelsPerMetre, y * api.pixelsPerMetre);
      return { tick: s.tick, x, y, entities: s.entities.length, drawn: circle ? { x: circle.x, y: circle.y } : null, drawnTileIndex: under ? under.index : null };
    });
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    const from = await state();
    await page.waitForTimeout(ms);
    const to = await state();
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(100);
    return { from, to, after: await state() };
  };

  // --- The tilemap matches the sim's grid.
  const map = await page.evaluate(() => {
    const api = window.__novaland;
    const scene = api.game.scene.getScene('world');
    const layer = scene.children.list.find((o) => o.type === 'TilemapLayer');
    if (!layer) return null;
    const indices = [];
    for (let row = 0; row < layer.tilemap.height; row += 1) {
      const line = [];
      for (let column = 0; column < layer.tilemap.width; column += 1) line.push(layer.getTileAt(column, row, true).index);
      indices.push(line);
    }
    const texture = api.game.textures.get(layer.tileset[0].image.key);
    const source = texture.getSourceImage();
    const circle = scene.children.list.find((o) => o.type === 'Arc');
    return {
      columns: layer.tilemap.width,
      rows: layer.tilemap.height,
      tileWidth: layer.tilemap.tileWidth,
      scale: layer.scaleX,
      x: layer.x,
      y: layer.y,
      depth: layer.depth,
      playerDepth: circle ? circle.depth : null,
      textureWidth: source.width,
      textureHeight: source.height,
      indices,
    };
  });
  results.push(check('a Phaser tilemap layer is on the scene', map !== null));
  results.push(check('the tilemap has one cell per level tile', map && map.columns === grid.columns && map.rows === grid.rows, `${map?.columns}x${map?.rows}`));
  const expectedIndices = grid.defIds.map((row) => row.map((defId) => tiles.findIndex((t) => t.id === defId)));
  results.push(check('every cell shows the tile of its def (grid and tilemap agree cell for cell)', map && JSON.stringify(map.indices) === JSON.stringify(expectedIndices)));
  results.push(check('placeholder tiles are 16x16, one per terrain def, in a generated strip', map && map.tileWidth === 16 && map.textureWidth === 16 * tiles.length && map.textureHeight === 16));
  results.push(check('the layer is scaled to one tile = TILE_SIZE metres and centred on the origin', map && Math.abs(map.scale - (grid.tileSize * PPM) / 16) < 1e-9 && map.x === -(grid.width / 2) * PPM && map.y === -(grid.height / 2) * PPM, `scale ${map?.scale}, at (${map?.x}, ${map?.y})`));
  results.push(check('the terrain draws below the player', map && map.depth < map.playerDepth));
  report.map = { ...map, indices: undefined };

  // --- The level is a forest clearing with paths and rocks.
  const names = tiles.map((t) => t.name);
  results.push(check('tile kinds: grass, dirt, tree, rock', ['grass', 'dirt', 'tree', 'rock'].every((n) => names.includes(n)), names.join(', ')));
  const border = [];
  for (let c = 0; c < grid.columns; c += 1) border.push(defAt(c, 0), defAt(c, grid.rows - 1));
  for (let r = 0; r < grid.rows; r += 1) border.push(defAt(0, r), defAt(grid.columns - 1, r));
  results.push(check('every edge tile is a tree (the forest border)', border.every((t) => t.name === 'tree')));
  const count = (name) => grid.defIds.flat().filter((id) => id === tileByName(name).id).length;
  results.push(check('grass inside, dirt paths and a few rocks', count('grass') > 300 && count('dirt') > 50 && count('rock') >= 3 && count('rock') < 30, `grass ${count('grass')}, dirt ${count('dirt')}, rock ${count('rock')}, tree ${count('tree')}`));

  // --- The player spawns on a path and is drawn there.
  const canvasCount = await page.locator('canvas').count();
  results.push(check('Phaser canvas is on the page', canvasCount === 1));
  const initial = await state();
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-spawn-on-path.png') });
  const spawnTile = tileOf(initial.x, initial.y);
  results.push(check('the player spawned on the level spawn tile', spawnTile.column === level.spawn.column && spawnTile.row === level.spawn.row, JSON.stringify(spawnTile)));
  results.push(check('the spawn tile is a dirt path', defAt(spawnTile.column, spawnTile.row).name === 'dirt'));
  results.push(check('the drawn tile under the player is that dirt tile', initial.drawnTileIndex === names.indexOf('dirt')));
  results.push(check('only merged terrain colliders and the player exist (no entity per tile)', initial.entities > 4 && initial.entities < count('tree') + count('rock'), `${initial.entities} entities for ${count('tree') + count('rock')} solid tiles`));
  report.steps.push({ step: 'spawn', ...initial, spawnTile });

  // --- Walk east along the path: free movement at the def speed, still on dirt.
  const east = await hold(['ArrowRight'], 1700);
  const heldTicks = east.to.tick - east.from.tick;
  const expected = (SPEED * heldTicks) / 60;
  const travelled = east.after.x - east.from.x;
  await page.screenshot({ path: path.join(PROOF, '03-browser-2-walking-the-path.png') });
  results.push(check('ArrowRight moves the player east at the def speed, unblocked on the path', Math.abs(travelled - expected) < 0.25 && travelled > 5, `${travelled.toFixed(2)}m over ${heldTicks} ticks, expected ${expected.toFixed(2)}m`));
  results.push(check('the player moves only on the x axis', east.after.y === east.from.y));
  const eastTile = tileOf(east.after.x, east.after.y);
  results.push(check('it is still on the dirt path', defAt(eastTile.column, eastTile.row).name === 'dirt', JSON.stringify(eastTile)));
  results.push(check('the drawn tile under it is dirt', east.after.drawnTileIndex === names.indexOf('dirt')));
  report.steps.push({ step: 'east', ...east.after, travelled, expected, heldTicks, eastTile });

  // --- Walk north until something solid stops the player: the grid says where.
  const north = await hold(['KeyW'], 2000);
  await page.screenshot({ path: path.join(PROOF, '03-browser-3-blocked-by-trees.png') });
  const columnsTouched = [tileOf(north.from.x - RADIUS + 1e-6, north.from.y).column, tileOf(north.from.x + RADIUS - 1e-6, north.from.y).column];
  let solidRow = tileOf(north.from.x, north.from.y).row;
  let blocker = null;
  while (solidRow >= 0 && !blocker) {
    const solid = columnsTouched.map((c) => defAt(c, solidRow)).find((t) => t.solid);
    if (solid) blocker = solid;
    else solidRow -= 1;
  }
  const stopY = tileBottom(solidRow) + RADIUS;
  results.push(check(`a ${blocker?.name} tile stops the player at its face (Rapier collision, derived from the grid)`, blocker && north.to.y >= stopY - 0.01 && north.to.y < stopY + 0.2, `y=${north.to.y.toFixed(3)}, face at ${tileBottom(solidRow).toFixed(2)}, stop at ${stopY.toFixed(2)}`));
  results.push(check('it walked north before being blocked', north.to.y < north.from.y - 1));
  results.push(check('the player stays put while still pushing into it', Math.abs(north.after.y - north.to.y) < 0.01));
  results.push(check('the blocker is a tree', blocker?.name === 'tree'));
  report.steps.push({ step: 'north', ...north.after, blocker: blocker?.name, solidRow, stopY, columnsTouched });

  // --- What is drawn matches the sim in every sample.
  const samples = [initial, east.after, north.after];
  const matches = samples.every((s) => s.drawn && Math.abs(s.drawn.x - s.x * PPM) < 1e-6 && Math.abs(s.drawn.y - s.y * PPM) < 1e-6);
  results.push(check(`the rendered player matches the sim position (${PPM} px/m) in ${samples.length} samples`, matches, JSON.stringify(north.after.drawn)));

  // --- A view of the forest border: the camera is a view concern, so moving it changes nothing in the sim.
  const beforeCamera = await state();
  await page.evaluate(({ x, y }) => window.__novaland.game.scene.getScene('world').cameras.main.centerOn(x, y), { x: (-grid.width / 2 + 15) * PPM, y: (-grid.height / 2 + 11.25) * PPM });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(PROOF, '03-browser-4-forest-border.png') });
  await page.evaluate(() => window.__novaland.game.scene.getScene('world').cameras.main.centerOn(0, 0));
  const afterCamera = await state();
  results.push(check('moving the camera for the screenshot changed nothing in the sim (the idle player did not move)', Math.abs(afterCamera.x - beforeCamera.x) < 1e-3 && Math.abs(afterCamera.y - beforeCamera.y) < 1e-3 && afterCamera.tick > beforeCamera.tick));
  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);
