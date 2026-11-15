/* global window */
/**
 * V4: the world looks and plays as before, in a real browser, solo and
 * online. For each mode it starts the real servers, opens the game in
 * Chromium and checks:
 *
 * - The whole map, terrain only, is the picture the code before this ticket
 *   drew (baseline/before-<mode>-terrain.png), pixel for pixel.
 * - The player appears on the same spawn tile.
 * - Holding W walks the player north into the forest and the first tree
 *   stops it at its face, where the map says the tree is.
 * - The terrain on screen is drawn as chunks: the report names them.
 * - On windows wider than the map, the very first frame rendered already has
 *   every chunk on screen (the camera has not been pointed anywhere yet).
 *
 * Expected numbers come from the map and the defs, read through the debug API.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { PLAY_VIEWPORT, WHOLE_MAP_VIEWPORT, openGame, startClient, startRoomServer, terrainPicture } from './browser.mjs';
import { PROOF, check, summarize, waitFor, writeProof } from './lib.mjs';

const HERE = import.meta.dirname;
/** Not 5147: that is the dev server left running for the human. */
const SOLO_PORT = 5947;
const SERVER_PORT = 5948;
const ONLINE_PORT = 5949;
const results = [];
const report = {};
const errors = [];
const servers = [];
let browser;
try {
  servers.push(await startClient({ port: SOLO_PORT }));
  servers.push(await startRoomServer({ port: SERVER_PORT }));
  servers.push(await startClient({ port: ONLINE_PORT, env: { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } }));
  results.push(check('the dev server, the room server and the online client are up, started by this run', true));
  browser = await chromium.launch();

  for (const [mode, port, online] of [['solo', SOLO_PORT, false], ['online', ONLINE_PORT, true]]) {
    // ---- The whole map, terrain only, against the picture taken before the change ----
    const whole = await openGame(browser, { port, viewport: WHOLE_MAP_VIEWPORT, online, errors });
    const after = await terrainPicture(whole);
    writeFileSync(path.join(PROOF, `04-after-${mode}-terrain.png`), after);
    const before = readFileSync(path.join(HERE, `baseline/before-${mode}-terrain.png`));
    const difference = differingPixels(before, after);
    results.push(check(`${mode}: the whole map is drawn exactly as before the change, pixel for pixel`, difference.sameSize && difference.differing === 0, `${difference.differing} of ${difference.total} pixels differ`));
    const wholeTerrain = await whole.evaluate(() => window.__novaland.terrain());
    await whole.context().close();

    // ---- Playing: the spawn, and a tree that stops the player ----
    const page = await openGame(browser, { port, viewport: PLAY_VIEWPORT, online, errors });
    const content = await page.evaluate(() => {
      const api = window.__novaland;
      const player = api.defs.find((def) => def.id === api.avatarDefIds[0]);
      // The first solid tile straight north of the spawn.
      let row = api.map.spawn.row;
      const isSolid = (tile) => api.defs.find((def) => def.id === api.tileDefIdAt(tile))?.solid === true;
      while (!isSolid({ column: api.map.spawn.column, row })) row -= 1;
      return { spawn: api.map.spawn, spawnCentre: api.tileCentre(api.map.spawn), treeRow: row, treeName: api.defs.find((def) => def.id === api.tileDefIdAt({ column: api.map.spawn.column, row })).name, tileSize: api.tiles.tileSize, radius: player.radius, bounds: api.tiles.bounds, checksum: api.tiles.checksum, chunkSize: api.chunkSize };
    });
    const start = await localPlayer(page);
    const spawnTile = await page.evaluate(({ x, y }) => window.__novaland.tileAt(x, y), start);
    // Solo the first player stands on the spawn tile itself; online the room's rng picks a free tile next to it, as before.
    const fromSpawn = Math.max(Math.abs(spawnTile.column - content.spawn.column), Math.abs(spawnTile.row - content.spawn.row));
    results.push(check(`${mode}: the player appears on the spawn tile the map names, (${content.spawn.column}, ${content.spawn.row})${online ? ' or beside it' : ''}`, online ? fromSpawn <= 1 : fromSpawn === 0, JSON.stringify(spawnTile)));
    await page.screenshot({ path: path.join(PROOF, `04-after-${mode}-play.png`) });

    await page.keyboard.down('KeyW');
    const stopped = await waitFor('the player to stop against the forest', {
      read: async () => {
        const first = await localPlayer(page);
        await page.waitForTimeout(400);
        const second = await localPlayer(page);
        return { first, second };
      },
      until: ({ first, second }) => first.y < start.y - 1 && Math.abs(first.y - second.y) < 1e-6,
      timeoutMs: 20000,
    }).catch(() => undefined);
    await page.keyboard.up('KeyW');
    const treeFace = (content.treeRow + 1) * content.tileSize;
    const stopY = treeFace + content.radius;
    const at = stopped?.second;
    // The tree straight north of where the player started; online that may be a column beside the spawn's.
    const northTree = at && (await page.evaluate(({ x, y }) => {
      const api = window.__novaland;
      const tile = api.tileAt(x, y - 0.5);
      return api.defs.find((def) => def.id === api.tileDefIdAt(tile))?.name;
    }, at));
    results.push(check(`${mode}: walking north, the ${content.treeName} at row ${content.treeRow} stops the player at its face`, at !== undefined && Math.abs(at.y - stopY) < 0.03 && northTree === content.treeName, at && `stopped at y ${at.y.toFixed(3)}, the face plus the radius is ${stopY}`));
    await page.screenshot({ path: path.join(PROOF, `04-after-${mode}-stopped-by-tree.png`) });

    const terrain = await page.evaluate(() => window.__novaland.terrain());
    results.push(check(`${mode}: the terrain is drawn as chunks of ${content.chunkSize}x${content.chunkSize} tiles`, wholeTerrain.chunksDrawn.length === wholeTerrain.chunksInMap && terrain.chunksDrawn.length >= 1 && terrain.groundTiles === terrain.chunksDrawn.length * content.chunkSize ** 2, `whole map: chunks ${wholeTerrain.chunksDrawn.join(' ')}; playing: ${terrain.chunksDrawn.join(' ')}`));
    report[mode] = { difference, content, start, spawnTile, stopped: at, stopY, wholeTerrain, terrain };
    await page.context().close();
  }
  // ---- The very first frame, on windows wider than the map ----
  // Before the player exists the camera has not been pointed anywhere; what is drawn then must still be what is rendered.
  for (const [name, viewport, deviceScaleFactor] of [['1920x1080', { width: 1920, height: 1080 }, 1], ['1728x1000 at 2x', { width: 1728, height: 1000 }, 2]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      window.__firstFrames = [];
      const hook = () => {
        const api = window.__novaland;
        if (!api) return void window.setTimeout(hook, 0);
        api.game.events.on('postrender', () => {
          const terrain = api.terrain();
          if (!terrain || window.__firstFrames.length >= 5) return;
          const view = api.game.scene.getScene('world').cameras.main.worldView;
          const chunkPixels = api.chunkSize * api.tiles.tileSize * api.pixelsPerMetre;
          const missing = api.tiles.chunks
            .filter((chunk) => chunk.column * chunkPixels < view.x + view.width && (chunk.column + 1) * chunkPixels > view.x && chunk.row * chunkPixels < view.y + view.height && (chunk.row + 1) * chunkPixels > view.y)
            .map((chunk) => `${chunk.column},${chunk.row}`)
            .filter((key) => !terrain.chunksDrawn.includes(key));
          window.__firstFrames.push({ tick: api.sim.tick, view: { x: view.x, y: view.y, width: view.width, height: view.height }, chunksDrawn: terrain.chunksDrawn, missing });
        });
      };
      hook();
    });
    await page.goto(`http://localhost:${SOLO_PORT}/`);
    await page.waitForFunction(() => window.__firstFrames?.length >= 5, null, { timeout: 20000 });
    const frames = await page.evaluate(() => window.__firstFrames);
    report[`firstFrames ${name}`] = frames;
    results.push(check(`${name}: from the first frame rendered, every chunk on screen is drawn`, frames.every((frame) => frame.missing.length === 0 && frame.chunksDrawn.length > 0), `first frame at tick ${frames[0].tick}: view x ${frames[0].view.x} to ${frames[0].view.x + frames[0].view.width}, chunks ${frames[0].chunksDrawn.join(' ')}`));
    await context.close();
  }
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('04-same-look.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Where the sim (solo) or the replica (online) has the local player, in metres. */
function localPlayer(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    return player ? { x: player.components.Position.x, y: player.components.Position.y } : undefined;
  });
}

function differingPixels(beforePng, afterPng) {
  const before = PNG.sync.read(beforePng);
  const after = PNG.sync.read(afterPng);
  const sameSize = before.width === after.width && before.height === after.height;
  let differing = 0;
  if (sameSize) {
    for (let index = 0; index < before.data.length; index += 4) {
      if (before.data[index] !== after.data[index] || before.data[index + 1] !== after.data[index + 1] || before.data[index + 2] !== after.data[index + 2] || before.data[index + 3] !== after.data[index + 3]) differing += 1;
    }
  }
  return { sameSize, differing, total: before.width * before.height, size: `${after.width}x${after.height}` };
}
