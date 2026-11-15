/* global window */
/**
 * V2: solo, in the browser, on the world itself.
 *
 * - The minimap is in the top-right corner, shows further than the screen
 *   and does not cover the HUD lines.
 * - Every tile it shows is the colour of the def the world has at that
 *   tile, compared pixel by pixel against the map at three places the
 *   player walks to.
 * - It is centred on the local player and follows them: walking east and
 *   south moves the terrain west and north by as many tiles.
 * - The local player, another player and the starting point are each
 *   marked, where they are, and look different.
 * - It is the same size and still right at every camera zoom, at a pixel
 *   ratio of 2, and in a window too narrow to sit beside the HUD lines.
 */
import { chromium } from 'playwright';
import { hex, hold, openGame, overlap, pictureOf, saveProofPictures, standStill, startClient, stateOf, terrainOnMinimap, terrainSummary } from './browser.mjs';
import { check, summarize, waitFor, writeProof } from './lib.mjs';

const PORT = 5961;
const VIEWPORT = { width: 960, height: 720 };
const LOCAL_PLAYER_COLOR = 0xffffff;
const results = [];
const report = {};
const errors = [];
let devServer;
let browser;
try {
  devServer = await startClient({ port: PORT });
  browser = await chromium.launch();
  const page = await openGame(browser, { port: PORT, viewport: VIEWPORT, errors });
  await standStill(page);

  // ---- Where it is ----
  const start = await stateOf(page);
  report.start = start;
  const { minimap } = start;
  const side = minimap.tilesAcross * minimap.cssPixelsPerTile;
  results.push(check('the minimap is a square in the top-right corner of the window', minimap.rect.width === side && minimap.rect.height === side && minimap.rect.x + minimap.rect.width < start.window.width && minimap.rect.x > start.window.width / 2 && minimap.rect.y >= 0 && minimap.rect.y < start.window.height / 4, JSON.stringify(minimap.rect)));
  results.push(check('it shows further than the screen reaches', minimap.tilesAcross > start.camera.visibleMetres.width && minimap.tilesAcross > start.camera.visibleMetres.height, `${minimap.tilesAcross} tiles across; the screen shows ${start.camera.visibleMetres.width} by ${start.camera.visibleMetres.height}`));
  results.push(check('it does not cover the HUD lines', !overlap(minimap.rect, start.hudLines), `lines ${JSON.stringify(start.hudLines)}`));
  results.push(check('it is centred on the local player', minimap.centre.x === start.player.x && minimap.centre.y === start.player.y, `centre ${JSON.stringify(minimap.centre)}, player (${start.player.x}, ${start.player.y})`));

  // ---- The terrain is the world's, at three places ----
  const atStart = await terrainOnMinimap(page);
  report.terrainAtStart = atStart;
  results.push(check('at the start every tile on the minimap is the colour of the def the world has there', atStart.wrongCount === 0 && atStart.byKind.grass > 0 && atStart.byKind.tree > 0 && atStart.byKind.rock > 0 && atStart.byKind['no tile'] > 0, terrainSummary(atStart)));
  await saveProofPictures(page, '02-solo-start');

  await hold(page, 'KeyD', 2400);
  await hold(page, 'KeyS', 1200);
  const walked = await stateOf(page);
  report.walked = walked;
  const moved = { x: walked.player.x - start.player.x, y: walked.player.y - start.player.y };
  const shifted = { x: walked.minimap.worldOriginOnScreen.x - minimap.worldOriginOnScreen.x, y: walked.minimap.worldOriginOnScreen.y - minimap.worldOriginOnScreen.y };
  results.push(check('walking east and south moved the player', moved.x > 8 && moved.y > 4, `${moved.x.toFixed(2)} m east, ${moved.y.toFixed(2)} m south`));
  // The minimap scrolls in whole pixels, so the shift is right to within one.
  results.push(check('and the minimap followed: its terrain moved west and north by as many tiles', Math.abs(shifted.x + moved.x * minimap.cssPixelsPerTile) <= 1 && Math.abs(shifted.y + moved.y * minimap.cssPixelsPerTile) <= 1 && walked.minimap.centre.x === walked.player.x && walked.minimap.centre.y === walked.player.y, `terrain shifted (${shifted.x}, ${shifted.y}) px for (${moved.x.toFixed(2)}, ${moved.y.toFixed(2)}) m at ${minimap.cssPixelsPerTile} px a tile`));
  const afterWalk = await terrainOnMinimap(page);
  report.terrainAfterWalk = afterWalk;
  results.push(check('after the walk every tile on the minimap is still the world\'s', afterWalk.wrongCount === 0 && afterWalk.byKind.grass > 0 && afterWalk.byKind.tree > 0, terrainSummary(afterWalk)));

  // ---- The three kinds of marker ----
  // Before anyone else joins: a second player appears on the starting point and would cover its marker.
  const alone = await stateOf(page);
  const pictureAlone = await pictureOf(page);
  const startingPointAlone = alone.minimap.marks.find((mark) => mark.source === 'landmark');
  const startingPointPixel = pictureAlone.colorAt(startingPointAlone.x, startingPointAlone.y);
  await saveProofPictures(page, '02-solo-walked');
  await page.keyboard.press('KeyJ');
  await waitFor('a second player on the minimap', { read: async () => (await stateOf(page)).minimap.marks.length, until: (count) => count === 3 });
  const marked = await stateOf(page);
  report.marked = marked;
  const picture = await pictureOf(page);
  const [startingPoint, otherPlayer, localPlayer] = marked.minimap.marks;
  const centreOfRect = { x: marked.minimap.rect.x + marked.minimap.rect.width / 2, y: marked.minimap.rect.y + marked.minimap.rect.height / 2 };
  const onScreen = (position) => ({ x: marked.minimap.worldOriginOnScreen.x + position.x * marked.minimap.cssPixelsPerTile, y: marked.minimap.worldOriginOnScreen.y + position.y * marked.minimap.cssPixelsPerTile });
  const near = (first, second) => Math.hypot(first.x - second.x, first.y - second.y) <= 1;
  const other = await page.evaluate((eid) => {
    const entity = window.__novaland.snapshot().entities.find((candidate) => candidate.id === eid);
    return { ...entity.components.Position, color: window.__novaland.defs.find((def) => def.id === entity.components.DefRef.id).color };
  }, otherPlayer.eid);
  results.push(check('the local player is marked in the middle of the minimap, in white', localPlayer.isLocalPlayer && localPlayer.eid === marked.player.eid && near(localPlayer, centreOfRect) && picture.colorAt(localPlayer.x, localPlayer.y) === LOCAL_PLAYER_COLOR, `at (${localPlayer.x}, ${localPlayer.y}), pixel ${hex(picture.colorAt(localPlayer.x, localPlayer.y))}`));
  results.push(check('the starting point is marked on the world\'s spawn tile, as a diamond in its own colour', startingPoint.source === 'landmark' && startingPoint.shape === 'diamond' && !startingPoint.onEdge && near(startingPoint, onScreen(marked.spawn)) && near(startingPointAlone, startingPoint) && startingPointPixel === startingPoint.color, `at (${startingPoint.x}, ${startingPoint.y}), pixel ${hex(startingPointPixel)}, marker ${hex(startingPoint.color)}`));
  results.push(check('the other player is marked where the sim has them, as a dot in their avatar\'s colour', otherPlayer.source === 'entity' && !otherPlayer.isLocalPlayer && otherPlayer.shape === 'dot' && otherPlayer.color === other.color && near(otherPlayer, onScreen(other)) && picture.colorAt(otherPlayer.x, otherPlayer.y) === other.color, `at (${otherPlayer.x.toFixed(1)}, ${otherPlayer.y.toFixed(1)}), pixel ${hex(picture.colorAt(otherPlayer.x, otherPlayer.y))}, avatar ${hex(other.color)}`));
  const looks = [LOCAL_PLAYER_COLOR, startingPoint.color, otherPlayer.color];
  results.push(check('the three are told apart: three colours, and the starting point is another shape', new Set(looks).size === 3 && startingPoint.shape !== otherPlayer.shape, looks.map(hex).join(', ')));
  await saveProofPictures(page, '02-solo-walked-with-another-player');

  await hold(page, 'KeyD', 3000);
  await hold(page, 'KeyW', 1500);
  const farCorner = await terrainOnMinimap(page);
  report.terrainFarCorner = farCorner;
  results.push(check('at a third place, across the clearing, every tile is the world\'s again', farCorner.wrongCount === 0 && Math.hypot(farCorner.centre.x - atStart.centre.x, farCorner.centre.y - atStart.centre.y) > 20, terrainSummary(farCorner)));
  const end = await stateOf(page);
  results.push(check('all of that painted each chunk of the world once: following the player repaints nothing', end.minimap.chunksPainted === end.minimap.chunksInMap && end.minimap.chunksDrawn.length === end.minimap.chunksInMap, `${end.minimap.chunksPainted} chunk textures painted for ${end.minimap.chunksInMap} chunks`));

  // ---- Every zoom, a Retina screen, a narrow window ----
  report.windows = [];
  for (const { name, viewport, pixelRatio = 1, below = false } of [
    { name: 'zoom-2', viewport: { width: 640, height: 480 } },
    { name: 'zoom-4', viewport: { width: 1280, height: 800 } },
    { name: 'zoom-6', viewport: { width: 1920, height: 1080 } },
    { name: 'retina', viewport: { width: 960, height: 720 }, pixelRatio: 2 },
    { name: 'narrow', viewport: { width: 420, height: 720 }, below: true },
  ]) {
    const other = await openGame(browser, { port: PORT, viewport, pixelRatio, errors, name: `${name}: ` });
    await hold(other, 'KeyD', 800);
    const state = await stateOf(other);
    const terrain = await terrainOnMinimap(other);
    report.windows.push({ name, state, terrain });
    const inWindow = state.minimap.rect.x >= 0 && state.minimap.rect.y >= 0 && state.minimap.rect.x + state.minimap.rect.width <= state.window.width && state.minimap.rect.y + state.minimap.rect.height <= state.window.height;
    const where = below ? state.minimap.rect.y >= state.hudLines.y + state.hudLines.height : state.minimap.rect.y < state.hudLines.y + state.hudLines.height;
    results.push(
      check(
        `${viewport.width}x${viewport.height} at ${pixelRatio}x (camera zoom ${state.camera.zoom}): the same ${side} CSS pixels, inside the window, ${below ? 'below' : 'beside'} the HUD lines, and every tile right`,
        state.minimap.rect.width === side && state.minimap.cssPixelsPerTile === minimap.cssPixelsPerTile && inWindow && where && !overlap(state.minimap.rect, state.hudLines) && terrain.wrongCount === 0 && terrain.tilesCompared > 1000,
        `rect ${JSON.stringify(state.minimap.rect)}; ${terrainSummary(terrain)}`,
      ),
    );
    await saveProofPictures(other, `02-solo-${name}`);
    await other.context().close();
  }
  const zooms = report.windows.map(({ state }) => state.camera.zoom);
  results.push(check('those windows cover different camera zooms', new Set(zooms).size >= 4, zooms.join(', ')));
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer?.stop();
}
report.results = results;
writeProof('02-solo.json', report);
process.exit(summarize(results) ? 0 : 1);
