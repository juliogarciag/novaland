/* global window */
/**
 * V3: the new world in a real browser, solo and online against the real
 * room server. For each mode it starts the servers, opens the game in
 * Chromium and:
 *
 * - takes a picture of the whole world, terrain only (solo);
 * - walks the player from the spawn through places of the new land, with
 *   `player/move` commands only, and takes a screenshot standing in each.
 *   Solo it visits every area; online it goes from the spawn to the corner
 *   of the world furthest from it;
 * - checks the walk had no hitch: the player never stopped making way, kept
 *   walking speed over every leg, every chunk the camera showed was drawn
 *   in every frame, and the game never took long over a frame, the frames
 *   that built or dropped chunks included. Frames are compared with the
 *   first leg, which is walked inside the old clearing.
 *
 * A frame is timed twice: from the frame before it (what the screen shows)
 * and the game's own work in it (the scene's update plus the render call).
 * Headless Chromium on a busy machine now and then draws a frame late with
 * no work of the game in it; the second number tells those apart, and the
 * report counts them.
 *
 * Where places are comes from the areas (the walker goes to the walkable
 * tile nearest each named tile); speed, radius and bounds come from the
 * debug API.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { openGame, PLAY_VIEWPORT, startClient, startRoomServer } from './browser.mjs';
import { PROOF, check, summarize, writeProof } from './lib.mjs';
import { installWalker } from './walker.mjs';

/** Not 5148: that is the dev server left running for the human. */
const SOLO_PORT = 5958;
const SERVER_PORT = 5959;
const ONLINE_PORT = 5960;

/** A tile in each place of the new land, by the area it is in. The first stop is inside the old clearing. */
const CLEARING_STOP = { name: 'clearing', tile: { column: 30, row: 6 } };
const PLACES = {
  northMeadow: { name: 'north-meadow', tile: { column: 18, row: -17 } },
  oldGrove: { name: 'old-grove', tile: { column: -30, row: -22 } },
  westWoods: { name: 'west-woods', tile: { column: -23, row: 15 } },
  stoneHollow: { name: 'stone-hollow', tile: { column: -26, row: 45 } },
  southGlade: { name: 'south-glade', tile: { column: 18, row: 44 } },
  farClearing: { name: 'far-clearing', tile: { column: 64, row: 46 } },
  cornerNook: { name: 'far-corner', tile: { column: 80, row: 57 } },
  eastGlade: { name: 'east-glade', tile: { column: 62, row: 14 } },
  rockField: { name: 'rock-field', tile: { column: 62, row: -16 } },
};
const TOURS = {
  // Every area, the far corner in the middle of the tour.
  solo: [CLEARING_STOP, PLACES.northMeadow, PLACES.oldGrove, PLACES.westWoods, PLACES.stoneHollow, PLACES.southGlade, PLACES.farClearing, PLACES.cornerNook, PLACES.eastGlade, PLACES.rockField],
  // From the spawn to the far corner, by the east.
  online: [CLEARING_STOP, PLACES.eastGlade, PLACES.farClearing, PLACES.cornerNook],
};
/** A frame this long is a hitch: three frames of a 60 Hz screen. */
const HITCH_MS = 50;
/** The game's own work in a frame: half of a 60 Hz frame is already too long. */
const GAME_WORK_LIMIT_MS = 8;

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

  // ---- The whole world in one picture ----
  {
    const page = await openGame(browser, { port: SOLO_PORT, viewport: PLAY_VIEWPORT, errors });
    const { bounds, pixelsPerMetre, chunksInMap } = await page.evaluate(() => ({ bounds: window.__novaland.tiles.bounds, pixelsPerMetre: window.__novaland.pixelsPerMetre, chunksInMap: window.__novaland.tiles.chunks.length }));
    await page.setViewportSize({ width: bounds.width * pixelsPerMetre, height: bounds.height * pixelsPerMetre });
    // The scene picks its own zoom when the window changes size: wait for that, then show one tile as 16 pixels.
    await page.waitForFunction((width) => window.__novaland.game.scale.width === width, bounds.width * pixelsPerMetre, { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const { game } = window.__novaland;
      const world = game.scene.getScene('world');
      world.cameras.main.setZoom(1);
      game.scene.getScene('hud').sys.setVisible(false);
    });
    await page.waitForFunction((wanted) => window.__novaland.terrain().chunksDrawn.length === wanted, chunksInMap, { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    const terrain = await page.evaluate(() => window.__novaland.terrain());
    writeFileSync(path.join(PROOF, '03-whole-world.png'), await page.locator('canvas').screenshot());
    results.push(check(`the whole world fits one picture of ${bounds.width}x${bounds.height} tiles, every chunk drawn`, terrain.chunksDrawn.length === chunksInMap, `${terrain.chunksDrawn.length} of ${chunksInMap} chunks, ${terrain.standingImages} trees and rocks`));
    report.wholeWorld = { bounds, terrain };
    await page.context().close();
  }

  for (const [mode, port, online] of [['solo', SOLO_PORT, false], ['online', ONLINE_PORT, true]]) {
    const page = await openGame(browser, { port, viewport: PLAY_VIEWPORT, online, errors });
    await page.evaluate(installWalker);
    const content = await page.evaluate(() => {
      const api = window.__novaland;
      const player = api.defs.find((def) => def.id === api.avatarDefIds[0]);
      return { spawn: api.map.spawn, bounds: api.tiles.bounds, speed: player.speed, radius: player.radius, chunksInMap: api.tiles.chunks.length, areas: api.map.areas.map((area) => ({ name: area.name, origin: area.origin, columns: area.rows[0].length, rows: area.rows.length })) };
    });
    const start = await page.evaluate(() => {
      const at = window.__walk.position();
      return window.__novaland.tileAt(at.x, at.y);
    });
    const fromSpawn = Math.max(Math.abs(start.column - content.spawn.column), Math.abs(start.row - content.spawn.row));
    results.push(check(`${mode}: the player appears on the spawn tile (${content.spawn.column}, ${content.spawn.row})${online ? ' or beside it' : ''}, where it always was`, online ? fromSpawn <= 2 : fromSpawn === 0, JSON.stringify(start)));

    const stops = [];
    let framesBefore = 0;
    for (const stop of TOURS[mode]) {
      const target = await page.evaluate((tile) => window.__walk.nearestWalkable(tile), stop.tile);
      await page.evaluate((tile) => window.__walk.walkTo(tile), target);
      await page.waitForFunction(() => window.__walk.state !== 'walking', null, { timeout: 180000, polling: 100 });
      const arrived = await page.evaluate(() => {
        const walk = window.__walk;
        const at = walk.position();
        return { state: walk.state, tile: window.__novaland.tileAt(at.x, at.y), leg: walk.legs.at(-1), stuckAt: walk.stuckAt, frames: walk.frames.length, terrain: window.__novaland.terrain() };
      });
      // Standing still: let the camera settle on the player before the picture.
      await page.waitForTimeout(400);
      const picture = `03-${mode}-${String(stops.length).padStart(2, '0')}-${stop.name}.png`;
      await page.screenshot({ path: path.join(PROOF, picture) });
      const area = content.areas.find(({ origin, columns, rows }) => target.column >= origin.column && target.column < origin.column + columns && target.row >= origin.row && target.row < origin.row + rows);
      const reached = arrived.state === 'arrived' && arrived.tile.column === target.column && arrived.tile.row === target.row;
      const metresPerSecond = arrived.leg ? arrived.leg.metres / arrived.leg.seconds : 0;
      results.push(check(`${mode}: walks to the ${stop.name} at tile (${target.column}, ${target.row}), in the area ${area?.name}`, reached && area?.name === (stop.name === 'far-corner' ? 'far-clearing' : stop.name), reached ? `${arrived.leg.metres} m in ${arrived.leg.seconds.toFixed(1)} s, ${metresPerSecond.toFixed(2)} m/s` : `${arrived.state} ${JSON.stringify(arrived.stuckAt ?? arrived.tile)}`));
      stops.push({ ...stop, target, area: area?.name, picture, ...arrived, metresPerSecond, framesInLeg: arrived.frames - framesBefore });
      framesBefore = arrived.frames;
      if (!reached) break;
    }

    const walk = await page.evaluate(() => ({ frames: window.__walk.frames, mostChunksDrawn: window.__walk.mostChunksDrawn, missingChunkFrames: window.__walk.missingChunkFrames, legs: window.__walk.legs }));
    const allReached = stops.length === TOURS[mode].length && stops.every((stop) => stop.state === 'arrived');
    const last = stops.at(-1);
    const corner = stops.find((stop) => stop.name === 'far-corner');

    // ---- The far edge ----
    const fromEastEdge = corner ? content.bounds.column + content.bounds.width - 1 - corner.tile.column : undefined;
    const fromSouthEdge = corner ? content.bounds.row + content.bounds.height - 1 - corner.tile.row : undefined;
    const tilesFromSpawn = corner ? Math.hypot(corner.tile.column - content.spawn.column, corner.tile.row - content.spawn.row) : 0;
    results.push(check(`${mode}: the walk reaches the far edge of the world, the corner furthest from the spawn`, corner?.state === 'arrived' && fromEastEdge <= 5 && fromSouthEdge <= 5, corner && `tile (${corner.tile.column}, ${corner.tile.row}): ${fromEastEdge} tiles from the east edge, ${fromSouthEdge} from the south edge, ${tilesFromSpawn.toFixed(0)} tiles from the spawn in a straight line`));
    if (!online) {
      const visited = new Set(stops.filter((stop) => stop.state === 'arrived').map((stop) => stop.area));
      results.push(check('solo: the tour stood in every area of the world', content.areas.every((area) => visited.has(area.name)), [...visited].join(', ')));
    }

    // ---- No hitch ----
    const totalMetres = walk.legs.reduce((sum, leg) => sum + leg.metres, 0);
    const totalSeconds = walk.legs.reduce((sum, leg) => sum + leg.seconds, 0);
    // A route turns corners and the walker rounds them; a player who is held up anywhere falls well under this.
    const slowestLeg = Math.min(...stops.map((stop) => stop.metresPerSecond));
    results.push(check(`${mode}: the player kept walking speed (${content.speed} m/s) over every leg, and never stopped making way`, allReached && slowestLeg > content.speed * 0.9, `${totalMetres} m in ${totalSeconds.toFixed(1)} s; slowest leg ${slowestLeg.toFixed(2)} m/s`));

    const clearingFrames = walk.frames.slice(0, stops[0]?.framesInLeg ?? 0);
    const newLandFrames = walk.frames.slice(clearingFrames.length);
    const inClearing = frameNumbers(clearingFrames);
    const inNewLand = frameNumbers(newLandFrames);
    const chunkFrames = frameNumbers(newLandFrames.filter((frame) => frame.chunksChanged));
    const lateFrames = newLandFrames.filter((frame) => frame.ms >= HITCH_MS);
    const lateBecauseOfTheGame = lateFrames.filter((frame) => frame.gameMs >= GAME_WORK_LIMIT_MS);
    results.push(check(`${mode}: the game never took ${GAME_WORK_LIMIT_MS} ms over a frame of the walk (update and render)`, newLandFrames.length > 500 && inNewLand.game.longest < GAME_WORK_LIMIT_MS, `${newLandFrames.length} frames in the new land: median ${inNewLand.game.median.toFixed(2)} ms, 99th percentile ${inNewLand.game.percentile99.toFixed(2)} ms, longest ${inNewLand.game.longest.toFixed(2)} ms`));
    results.push(check(`${mode}: the game's work per frame in the new land is what it is in the old clearing`, inNewLand.game.median < inClearing.game.median + 1 && inNewLand.game.percentile99 < inClearing.game.percentile99 + 2, `clearing: median ${inClearing.game.median.toFixed(2)} ms, 99th ${inClearing.game.percentile99.toFixed(2)} ms, longest ${inClearing.game.longest.toFixed(2)} ms (${clearingFrames.length} frames)`));
    results.push(check(`${mode}: building or dropping chunks cost the game no more than any other frame`, chunkFrames.count >= 3 && chunkFrames.game.longest < GAME_WORK_LIMIT_MS, `${chunkFrames.count} such frames: game work median ${chunkFrames.game.median.toFixed(2)} ms, longest ${chunkFrames.game.longest.toFixed(2)} ms; time since the frame before: median ${chunkFrames.median.toFixed(1)} ms, longest ${chunkFrames.longest.toFixed(1)} ms`));
    results.push(check(`${mode}: frames came at the screen's rate, and none came ${HITCH_MS} ms late because of the game`, Math.abs(inNewLand.median - inClearing.median) < 2 && lateBecauseOfTheGame.length === 0 && lateFrames.length <= newLandFrames.length / 100, `median ${inNewLand.median.toFixed(1)} ms, 99th percentile ${inNewLand.percentile99.toFixed(1)} ms, longest ${inNewLand.longest.toFixed(1)} ms; ${lateFrames.length} of ${newLandFrames.length} came ${HITCH_MS} ms or more after the one before, with at most ${Math.max(0, ...lateFrames.map((frame) => frame.gameMs)).toFixed(2)} ms of game work in them; clearing: median ${inClearing.median.toFixed(1)} ms, longest ${inClearing.longest.toFixed(1)} ms`));
    results.push(check(`${mode}: every chunk the camera showed was drawn in every frame, and never many at once`, walk.missingChunkFrames === 0 && walk.mostChunksDrawn < content.chunksInMap, `at most ${walk.mostChunksDrawn} of ${content.chunksInMap} chunks drawn at once`));

    let onlineReport;
    if (online) {
      onlineReport = await page.evaluate(() => {
        const { online: connection } = window.__novaland;
        const drawn = connection.localPlayerDrawnAt();
        const at = window.__walk.position();
        return { status: connection.status().kind, malformedUpdates: connection.malformedUpdates(), prediction: connection.prediction(), drawn, replica: at, entities: window.__novaland.snapshot().entities.length };
      });
      const apart = onlineReport.drawn ? Math.hypot(onlineReport.drawn.x - onlineReport.replica.x, onlineReport.drawn.y - onlineReport.replica.y) : Infinity;
      results.push(check('online: still seated at the far corner, drawn where the server has the player, and the replica holds the player only', onlineReport.status === 'online' && onlineReport.malformedUpdates === 0 && apart < 0.01 && onlineReport.entities === 1, `status ${onlineReport.status}, ${apart.toFixed(4)} m apart, ${onlineReport.entities} entity`));
      // Being seated at all means the page and the server hold the same map: the welcome carries its checksum and another is refused.
      // A correction is the server placing the player elsewhere than the page guessed; a turn applied a tick or two apart gives a small one (ADR 0012).
      const correctionLimit = (6 * content.speed) / 60;
      results.push(check(`online: the page predicted the player on the server's ground the whole way: no correction beyond six ticks of walking (${correctionLimit} m)`, onlineReport.prediction?.predicting === true && onlineReport.prediction.largestCorrectionMetres < correctionLimit, JSON.stringify(onlineReport.prediction)));
    }
    report[mode] = { content, start, stops, legs: walk.legs, totalMetres, totalSeconds, frames: { inClearing, inNewLand, chunkFrames }, mostChunksDrawn: walk.mostChunksDrawn, missingChunkFrames: walk.missingChunkFrames, endedAt: last?.tile, online: onlineReport };
    await page.context().close();
  }
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('03-walk.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The median, the 99th percentile and the longest of a list of frames, in milliseconds: of the time between frames, and under `game` of the game's own work in them. */
function frameNumbers(frames) {
  const sorted = frames.map((frame) => frame.ms).sort((first, second) => first - second);
  const game = frames.map((frame) => frame.gameMs).sort((first, second) => first - second);
  const of = (numbers) => (numbers.length === 0 ? { median: NaN, percentile99: NaN, longest: NaN } : { median: numbers[Math.floor(numbers.length / 2)], percentile99: numbers[Math.floor(numbers.length * 0.99)], longest: numbers[numbers.length - 1] });
  return { count: sorted.length, ...of(sorted), game: of(game) };
}
