/* global window */
/**
 * V3: solo, in the browser, on the generated 400x300 map
 * (`VITE_GENERATED_MAP=400x300`: 130 chunks, a hundred times the world).
 *
 * - Near the start the starting point is marked where it is. Walked more
 *   than the minimap's reach away, its marker sits on the minimap's edge
 *   and points back: the line from the middle of the minimap through the
 *   marker is the line from the player to the starting point. That holds
 *   after turning a corner too.
 * - Far from the start, across several chunks, every tile on the minimap is
 *   still the colour of the def the map has there.
 * - What the minimap keeps painted depends on its own size: a few chunks
 *   of 130, never more as the player walks, and standing still paints
 *   nothing.
 */
import { chromium } from 'playwright';
import { hex, openGame, pictureOf, saveProofPictures, standStill, startClient, stateOf, terrainOnMinimap, terrainSummary, walk } from './browser.mjs';
import { check, summarize, writeProof } from './lib.mjs';

const PORT = 5962;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = {};
const errors = [];
let devServer;
let browser;
try {
  devServer = await startClient({ port: PORT, env: { VITE_GENERATED_MAP: '400x300' } });
  browser = await chromium.launch();
  const page = await openGame(browser, { port: PORT, viewport: VIEWPORT, errors });
  await standStill(page);

  const start = await stateOf(page);
  report.start = start;
  const reach = start.minimap.tilesAcross / 2;
  // What a square of that many tiles can touch at worst, and with the half chunk it keeps on every side: the screen and the chunk size decide, never the map.
  const MOST_CHUNKS_SHOWN = (Math.floor(start.minimap.tilesAcross / start.chunkSize) + 2) ** 2;
  const MOST_CHUNKS_KEPT = (Math.floor((start.minimap.tilesAcross + start.chunkSize) / start.chunkSize) + 2) ** 2;
  const chunksOfMap = Math.ceil(start.bounds.width / start.chunkSize) * Math.ceil(start.bounds.height / start.chunkSize);
  results.push(check('the map is the generated 400x300 one', start.bounds.width === 400 && start.bounds.height === 300 && start.minimap.chunksInMap === chunksOfMap && chunksOfMap > 100, `${start.minimap.chunksInMap} chunks; a minimap shows at most ${MOST_CHUNKS_SHOWN} and keeps at most ${MOST_CHUNKS_KEPT}`));
  results.push(check('at the start only the chunks under the minimap are painted', start.minimap.chunksDrawn.length <= MOST_CHUNKS_SHOWN && start.minimap.chunksPainted === start.minimap.chunksDrawn.length, `${start.minimap.chunksDrawn.length} of ${start.minimap.chunksInMap}: ${start.minimap.chunksDrawn.join(' ')}`));
  const terrainAtStart = await terrainOnMinimap(page);
  report.terrainAtStart = terrainAtStart;
  results.push(check('at the start every tile on the minimap is the colour of the def the map has there', terrainAtStart.wrongCount === 0 && terrainAtStart.byKind.tree > 50 && terrainAtStart.byKind.rock > 10 && terrainAtStart.byKind['no tile'] === undefined, terrainSummary(terrainAtStart)));
  await saveProofPictures(page, '03-big-map-start');

  // ---- In range: the marker is on the starting point ----
  const nearby = await walk(page, { key: 'KeyD', aside: 'KeyS', metres: reach / 2 });
  report.nearby = nearby;
  const nearbyMark = startingPointOf(nearby);
  const expectedNearby = onScreen(nearby, nearby.spawn);
  results.push(check(`${distanceToStart(nearby).toFixed(1)} tiles from the start, within reach: the starting point is marked where it is`, !nearbyMark.onEdge && Math.hypot(nearbyMark.x - expectedNearby.x, nearbyMark.y - expectedNearby.y) <= 1, `marker at (${nearbyMark.x.toFixed(1)}, ${nearbyMark.y.toFixed(1)}), the spawn tile is drawn at (${expectedNearby.x.toFixed(1)}, ${expectedNearby.y.toFixed(1)})`));
  await saveProofPictures(page, '03-big-map-start-in-range');

  // ---- Out of range: the marker is on the edge and points home ----
  const far = await walk(page, { key: 'KeyD', aside: 'KeyS', metres: reach });
  report.far = far;
  results.push(await pointsHome(page, far, 'walked east past the reach'));
  await saveProofPictures(page, '03-big-map-far-east');

  const corner = await walk(page, { key: 'KeyS', aside: 'KeyD', metres: reach * 0.75 });
  report.corner = corner;
  results.push(await pointsHome(page, corner, 'then south, round a corner'));
  results.push(check('the marker moved along the edge as the direction home changed', Math.abs(bearingOfMark(corner) - bearingOfMark(far)) > 10, `${bearingOfMark(far).toFixed(1)} degrees, then ${bearingOfMark(corner).toFixed(1)} degrees`));
  await saveProofPictures(page, '03-big-map-far-south-east');

  // ---- Far away the terrain is still the map's, and the cost did not grow ----
  const terrainFar = await terrainOnMinimap(page);
  report.terrainFar = terrainFar;
  results.push(check('far from the start every tile on the minimap is still the map\'s', terrainFar.wrongCount === 0 && terrainFar.byKind.tree > 50 && terrainFar.tilesCompared > 5000, terrainSummary(terrainFar)));
  const samples = [start, nearby, far, corner].map(({ minimap }) => minimap.chunksDrawn.length);
  results.push(check('walking changed which chunks are painted, and never to more than the minimap can keep', corner.minimap.chunksDrawn.join() !== start.minimap.chunksDrawn.join() && Math.max(...samples) <= MOST_CHUNKS_KEPT && corner.minimap.chunksPainted > start.minimap.chunksPainted && corner.minimap.chunksPainted < corner.minimap.chunksInMap / 2, `${samples.join(', ')} chunks kept at the four stops; ${corner.minimap.chunksPainted} painted in all, of ${corner.minimap.chunksInMap}; now ${corner.minimap.chunksDrawn.join(' ')}`));
  const textures = await page.evaluate(() => window.__novaland.game.textures.getTextureKeys().filter((key) => key.startsWith('minimap-chunk:')).length);
  results.push(check('Phaser holds one texture per kept chunk: the dropped ones are gone', textures === corner.minimap.chunksDrawn.length, `${textures} textures for ${corner.minimap.chunksDrawn.length} chunks`));
  await page.waitForTimeout(1500);
  const rested = await stateOf(page);
  results.push(check('standing still for a second and a half painted nothing', rested.minimap.chunksPainted === corner.minimap.chunksPainted, `${rested.minimap.chunksPainted} before and after`));
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer?.stop();
}
report.results = results;
writeProof('03-big-map.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function startingPointOf(state) {
  return state.minimap.marks.find((mark) => mark.source === 'landmark');
}

/** Where a point of the world (metres) is drawn on the minimap, in CSS pixels. */
function onScreen({ minimap }, position) {
  return { x: minimap.worldOriginOnScreen.x + position.x * minimap.cssPixelsPerTile, y: minimap.worldOriginOnScreen.y + position.y * minimap.cssPixelsPerTile };
}

/** How far the player is from the starting point along the axis it is furthest on, in tiles: what the minimap's reach is measured against. */
function distanceToStart({ player, spawn }) {
  return Math.max(Math.abs(spawn.x - player.x), Math.abs(spawn.y - player.y));
}

function centreOf({ minimap }) {
  return { x: minimap.rect.x + minimap.rect.width / 2, y: minimap.rect.y + minimap.rect.height / 2 };
}

/** The compass bearing of the starting point's marker seen from the middle of the minimap, in degrees. */
function bearingOfMark(state) {
  const mark = startingPointOf(state);
  const centre = centreOf(state);
  return (Math.atan2(mark.y - centre.y, mark.x - centre.x) * 180) / Math.PI;
}

/** One check: the starting point is out of reach, its marker is on the edge of the minimap, inside it, drawn in its colour, and on the line home. */
async function pointsHome(page, state, when) {
  const mark = startingPointOf(state);
  const centre = centreOf(state);
  const home = (Math.atan2(state.spawn.y - state.player.y, state.spawn.x - state.player.x) * 180) / Math.PI;
  // The minimap scrolls in whole pixels, so its middle is up to half a pixel off the player: under a degree at this distance.
  const offBy = Math.abs(((bearingOfMark(state) - home + 540) % 360) - 180);
  const fromCentre = Math.max(Math.abs(mark.x - centre.x), Math.abs(mark.y - centre.y));
  const half = state.minimap.rect.width / 2;
  const picture = await pictureOf(page);
  const pixel = picture.colorAt(mark.x, mark.y);
  // The arrowhead is past the marker, toward home: 8 px out is past the diamond's corner (5 px) and inside the arrow, so it must be the marker's colour too.
  const straight = Math.hypot(mark.x - centre.x, mark.y - centre.y);
  const arrow = picture.colorAt(mark.x + ((mark.x - centre.x) / straight) * 8, mark.y + ((mark.y - centre.y) / straight) * 8);
  return check(
    `${when}, ${distanceToStart(state).toFixed(1)} tiles from the start: its marker is on the minimap's edge and points home`,
    distanceToStart(state) > state.minimap.tilesAcross / 2 && mark.onEdge && Math.abs(fromCentre - (half - state.minimap.edgeInset)) <= 1.5 && offBy < 1 && pixel === mark.color && arrow === mark.color,
    `home is at ${home.toFixed(1)} degrees, the marker at ${bearingOfMark(state).toFixed(1)}; ${fromCentre.toFixed(1)} px from the middle of a minimap ${half} px to its edge, ${state.minimap.edgeInset} px inside it; pixel ${hex(pixel)}, arrow ${hex(arrow)}, marker ${hex(mark.color)}`,
  );
}
