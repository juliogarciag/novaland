/* global window */
/**
 * V3: the new world in a real browser, solo and online against the real
 * room server. For each mode it starts the servers, opens the game in
 * Chromium and:
 *
 * - takes a picture of the whole world (solo);
 * - walks the player around inside the old clearing first, as the control
 *   everything after is compared with;
 * - walks the player from there through places of the new land, with
 *   `player/move` commands only, and takes a screenshot standing in each.
 *   Solo it visits every area; online it goes to the corner of the world
 *   furthest from the spawn;
 * - checks the walk had no hitch: the player made way in every thirty
 *   ticks of every leg, every chunk the camera showed was drawn in every
 *   frame, the game's own work per frame stayed small and no more than in
 *   the clearing, the frames that built or dropped chunks included.
 *
 * How often frames came late, at all and right after a chunk change, is
 * reported for both walks with the machine's load, and not asserted: in
 * headless Chromium, which renders in software, it follows what else the
 * machine is doing from one minute to the next far more than anything the
 * game does. proof/04-real-graphics-walk.json is the same walker run by
 * hand in a browser with a graphics card (see the README).
 *
 * A frame is timed twice: from the frame before it (what the screen shows)
 * and the game's own work in it (the scene's update, the render call, and
 * the WebSocket message handlers since the frame before, where a server
 * state is applied and the prediction reconciled). Every frame that came
 * 50 ms or more after the one before is written to the report with its
 * place, its game work and how many frames after a chunk change it fell.
 *
 * Where places are comes from the areas (the walker goes to the walkable
 * tile nearest each named tile); speed, radius and bounds come from the
 * debug API.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openGame, PLAY_VIEWPORT, startClient, startRoomServer } from './browser.mjs';
import { PROOF, check, summarize, writeProof } from './lib.mjs';
import { installWalker, timeMessageHandlers } from './walker.mjs';

/** Not 5148: that is the dev server left running for the human. */
const SOLO_PORT = 5958;
const SERVER_PORT = 5959;
const ONLINE_PORT = 5960;

/** Stops inside the old clearing: the control walk. Only the last one gets a screenshot. */
const CLEARING_STOPS = [
  { name: 'clearing', tile: { column: 30, row: 6 } },
  { name: 'clearing', tile: { column: 5, row: 24 } },
  { name: 'clearing', tile: { column: 34, row: 24 } },
  { name: 'clearing', tile: { column: 5, row: 5 } },
  { name: 'clearing', tile: { column: 30, row: 12 } },
];
/** A tile in each place of the new land, named by the area it is in. */
const PLACES = {
  northMeadow: { name: 'north-meadow', tile: { column: 18, row: -17 } },
  oldGrove: { name: 'old-grove', tile: { column: -30, row: -22 } },
  westWoods: { name: 'west-woods', tile: { column: -23, row: 15 } },
  stoneHollow: { name: 'stone-hollow', tile: { column: -26, row: 45 } },
  southGlade: { name: 'south-glade', tile: { column: 18, row: 44 } },
  farClearing: { name: 'far-clearing', tile: { column: 64, row: 46 } },
  farCorner: { name: 'far-corner', area: 'far-clearing', tile: { column: 80, row: 57 } },
  eastGlade: { name: 'east-glade', tile: { column: 62, row: 14 } },
  rockField: { name: 'rock-field', tile: { column: 62, row: -16 } },
};
const TOURS = {
  // Every area, the far corner in the middle of the tour.
  solo: [PLACES.northMeadow, PLACES.oldGrove, PLACES.westWoods, PLACES.stoneHollow, PLACES.southGlade, PLACES.farClearing, PLACES.farCorner, PLACES.eastGlade, PLACES.rockField],
  // To the far corner, by the east.
  online: [PLACES.eastGlade, PLACES.farClearing, PLACES.farCorner],
};
/** A frame that comes this long after the one before is late: three frames of a 60 Hz screen. */
const LATE_FRAME_MS = 50;
/** The game's own work in a frame: half of a 60 Hz frame is already too long. */
const GAME_WORK_LIMIT_MS = 8;
/** A chunk built or dropped in one frame could delay this many frames after it (the graphics work comes after the render call). */
const FRAMES_A_CHUNK_CHANGE_MAY_DELAY = 3;

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
      game.scene.getScene('world').cameras.main.setZoom(1);
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
    const page = await openGame(browser, { port, viewport: PLAY_VIEWPORT, online, errors, beforeLoad: timeMessageHandlers });
    await page.evaluate(installWalker);
    const content = await page.evaluate(() => {
      const game = window.__novaland;
      const player = game.defs.find((def) => def.id === game.avatarDefIds[0]);
      return { spawn: game.map.spawn, bounds: game.tiles.bounds, speed: player.speed, radius: player.radius, chunksInMap: game.tiles.chunks.length, areas: game.map.areas.map((area) => ({ name: area.name, origin: area.origin, columns: area.rows[0].length, rows: area.rows.length })) };
    });
    const areaOf = (tile) => content.areas.find(({ origin, columns, rows }) => tile.column >= origin.column && tile.column < origin.column + columns && tile.row >= origin.row && tile.row < origin.row + rows)?.name;
    const startTile = await page.evaluate(() => {
      const startsAt = window.__walk.simPosition();
      return window.__novaland.tileAt(startsAt.x, startsAt.y);
    });
    const tilesFromSpawn = Math.max(Math.abs(startTile.column - content.spawn.column), Math.abs(startTile.row - content.spawn.row));
    results.push(check(`${mode}: the player appears on the spawn tile (${content.spawn.column}, ${content.spawn.row})${online ? ' or beside it' : ''}, where it always was`, online ? tilesFromSpawn <= 2 : tilesFromSpawn === 0, JSON.stringify(startTile)));

    // ---- The walk: the control inside the clearing, then the tour ----
    const stops = [];
    let framesBeforeLeg = 0;
    const tour = [...CLEARING_STOPS, ...TOURS[mode]];
    for (const [stopIndex, stop] of tour.entries()) {
      const target = await page.evaluate((tile) => window.__walk.nearestWalkableTile(tile), stop.tile);
      await page.evaluate((tile) => window.__walk.walkTo(tile), target);
      await page.waitForFunction(() => window.__walk.state !== 'walking', null, { timeout: 180000, polling: 100 });
      const arrival = await page.evaluate(() => {
        const walk = window.__walk;
        const standsAt = walk.simPosition();
        return { state: walk.state, tile: window.__novaland.tileAt(standsAt.x, standsAt.y), leg: walk.legs.at(-1), stuckAt: walk.stuckAt, framesSoFar: walk.frames.length };
      });
      const isControl = stopIndex < CLEARING_STOPS.length;
      let picture;
      if (!isControl || stopIndex === CLEARING_STOPS.length - 1) {
        // Standing still: let the camera settle on the player before the picture.
        await page.waitForTimeout(400);
        picture = `03-${mode}-${String(stops.filter((earlier) => earlier.picture).length).padStart(2, '0')}-${stop.name}.png`;
        await page.screenshot({ path: path.join(PROOF, picture) });
      }
      const hasArrived = arrival.state === 'arrived' && arrival.tile.column === target.column && arrival.tile.row === target.row;
      const area = areaOf(target);
      results.push(check(`${mode}: walks to the ${stop.name} at tile (${target.column}, ${target.row}), in the area ${area}`, hasArrived && area === (stop.area ?? stop.name), hasArrived ? `${arrival.leg.metres} m of route in ${arrival.leg.seconds.toFixed(1)} s` : `${arrival.state} ${JSON.stringify(arrival.stuckAt ?? arrival.tile)}`));
      stops.push({ name: stop.name, isControl, target, area, picture, state: arrival.state, tile: arrival.tile, leg: arrival.leg, firstFrame: framesBeforeLeg, frames: arrival.framesSoFar - framesBeforeLeg });
      framesBeforeLeg = arrival.framesSoFar;
      if (!hasArrived) break;
    }

    const walk = await page.evaluate(() => ({ frames: window.__walk.frames, mostChunksDrawn: window.__walk.mostChunksDrawn, framesMissingAChunk: window.__walk.framesMissingAChunk }));
    const hasArrivedEverywhere = stops.length === tour.length && stops.every((stop) => stop.state === 'arrived');
    const cornerStop = stops.find((stop) => stop.name === PLACES.farCorner.name);

    // ---- The far edge ----
    const tilesFromEastEdge = cornerStop ? content.bounds.column + content.bounds.width - 1 - cornerStop.tile.column : undefined;
    const tilesFromSouthEdge = cornerStop ? content.bounds.row + content.bounds.height - 1 - cornerStop.tile.row : undefined;
    const straightLineFromSpawn = cornerStop ? Math.hypot(cornerStop.tile.column - content.spawn.column, cornerStop.tile.row - content.spawn.row) : 0;
    results.push(check(`${mode}: the walk reaches the far edge of the world, the corner furthest from the spawn`, cornerStop?.state === 'arrived' && tilesFromEastEdge <= 5 && tilesFromSouthEdge <= 5, cornerStop && `tile (${cornerStop.tile.column}, ${cornerStop.tile.row}): ${tilesFromEastEdge} tiles from the east edge, ${tilesFromSouthEdge} from the south edge, ${straightLineFromSpawn.toFixed(0)} tiles from the spawn in a straight line`));
    if (!online) {
      const areasStoodIn = new Set(stops.filter((stop) => stop.state === 'arrived').map((stop) => stop.area));
      results.push(check('solo: the tour stood in every area of the world', content.areas.every((area) => areasStoodIn.has(area.name)), [...areasStoodIn].join(', ')));
    }

    // ---- No hitch: the player made way all the time ----
    const tourStops = stops.filter((stop) => !stop.isControl);
    const routeMetres = tourStops.reduce((sum, stop) => sum + (stop.leg?.metres ?? 0), 0);
    const seconds = tourStops.reduce((sum, stop) => sum + (stop.leg?.seconds ?? 0), 0);
    // Thirty ticks of walking are speed / 2 of path, turns included. Sliding along a tree is slower and positions are
    // sampled about every third tick, so three quarters of it is asked: less is a player held up for some eight ticks.
    const leastWayExpected = (0.75 * content.speed) / 2;
    const leastWayOf = (legStops) => Math.min(...legStops.map((stop) => stop.leg?.leastMetresInThirtyTicks ?? 0));
    const spansOfThirtyTicks = tourStops.reduce((sum, stop) => sum + (stop.leg?.spansOfThirtyTicks ?? 0), 0);
    results.push(check(`${mode}: in every thirty ticks of the walk through the new land the player made at least ${leastWayExpected} m of way (walking speed is ${content.speed} m/s)`, hasArrivedEverywhere && leastWayOf(tourStops) >= leastWayExpected, `${spansOfThirtyTicks} spans of thirty ticks over ${routeMetres} m of route in ${seconds.toFixed(1)} s: the least way made was ${leastWayOf(tourStops).toFixed(2)} m; in the clearing ${leastWayOf(stops.filter((stop) => stop.isControl)).toFixed(2)} m`));

    // ---- No hitch: frames ----
    const controlFrameCount = stops.filter((stop) => stop.isControl).reduce((sum, stop) => sum + stop.frames, 0);
    const clearingFrames = walk.frames.slice(0, controlFrameCount);
    const newLandFrames = walk.frames.slice(controlFrameCount);
    const inClearing = frameStatistics(clearingFrames);
    const inNewLand = frameStatistics(newLandFrames);
    const chunkChangeFrames = frameStatistics(newLandFrames.filter((frame) => frame.framesSinceChunkChange === 0));
    const lateFrames = walk.frames
      .map((frame, index) => ({ index, land: index < controlFrameCount ? 'clearing' : 'new land', leg: stops.findLast((stop) => stop.firstFrame <= index)?.name, ...frame }))
      .filter((frame) => frame.ms >= LATE_FRAME_MS);
    const lateInNewLand = lateFrames.filter((frame) => frame.land === 'new land');
    const lateInClearing = lateFrames.filter((frame) => frame.land === 'clearing');
    const isRightAfterChunkChange = (frame) => frame.framesSinceChunkChange !== null && frame.framesSinceChunkChange <= FRAMES_A_CHUNK_CHANGE_MAY_DELAY;
    const framesAfterChunkChange = newLandFrames.filter(isRightAfterChunkChange);
    const lateAfterChunkChange = lateInNewLand.filter(isRightAfterChunkChange);
    const lateWithGameWork = lateInNewLand.filter((frame) => frame.gameMs >= GAME_WORK_LIMIT_MS);
    const lateShare = (late, all) => (all.length === 0 ? NaN : (100 * late.length) / all.length);
    const describe = (statistics) => `median ${statistics.game.median.toFixed(2)} ms, 99th percentile ${statistics.game.percentile99.toFixed(2)} ms, longest ${statistics.game.longest.toFixed(2)} ms`;

    results.push(check(`${mode}: the game never took ${GAME_WORK_LIMIT_MS} ms over a frame of the walk (update, render${online ? ', and applying server states' : ''})`, newLandFrames.length > 500 && inNewLand.game.longest < GAME_WORK_LIMIT_MS, `${newLandFrames.length} frames in the new land: ${describe(inNewLand)}`));
    results.push(check(`${mode}: the game's work per frame in the new land is no more than in the old clearing (by under half a millisecond)`, clearingFrames.length > 500 && inNewLand.game.median < inClearing.game.median + 0.5 && inNewLand.game.percentile99 < inClearing.game.percentile99 + 0.5, `${clearingFrames.length} frames in the clearing: ${describe(inClearing)}`));
    results.push(check(`${mode}: building or dropping chunks cost the game no more than any other frame`, chunkChangeFrames.count >= 3 && chunkChangeFrames.game.longest < GAME_WORK_LIMIT_MS, `${chunkChangeFrames.count} such frames: ${describe(chunkChangeFrames)}`));
    results.push(check(`${mode}: no frame that came ${LATE_FRAME_MS} ms late had ${GAME_WORK_LIMIT_MS} ms of game work in it`, lateWithGameWork.length === 0, `${lateInNewLand.length} late frames in the new land, the most game work in one ${Math.max(0, ...lateInNewLand.map((frame) => frame.gameMs)).toFixed(2)} ms`));
    // Not a check: late frames with no work of the game in them are the browser's and the machine's.
    const loadAverage = os.loadavg()[0];
    console.log(`INFO  ${mode}: frames that came ${LATE_FRAME_MS} ms late: new land ${lateInNewLand.length} of ${newLandFrames.length} (${lateShare(lateInNewLand, newLandFrames).toFixed(2)}%), median ${inNewLand.median.toFixed(1)} ms, 99th percentile ${inNewLand.percentile99.toFixed(1)} ms, ${inNewLand.framesPerSecond.toFixed(1)} frames a second; clearing ${lateInClearing.length} of ${clearingFrames.length} (${lateShare(lateInClearing, clearingFrames).toFixed(2)}%), median ${inClearing.median.toFixed(1)} ms, 99th percentile ${inClearing.percentile99.toFixed(1)} ms, ${inClearing.framesPerSecond.toFixed(1)} frames a second; of the ${framesAfterChunkChange.length} frames within ${FRAMES_A_CHUNK_CHANGE_MAY_DELAY} frames of a chunk being built or dropped, ${lateAfterChunkChange.length}; machine load average ${loadAverage.toFixed(1)} on ${os.cpus().length} cores`);
    results.push(check(`${mode}: every chunk the camera showed was drawn in every frame, and never many at once`, walk.framesMissingAChunk === 0 && walk.mostChunksDrawn < content.chunksInMap, `at most ${walk.mostChunksDrawn} of ${content.chunksInMap} chunks drawn at once`));

    let connection;
    if (online) {
      connection = await page.evaluate(() => {
        const { online: onlineApi } = window.__novaland;
        return { status: onlineApi.status().kind, malformedUpdates: onlineApi.malformedUpdates(), prediction: onlineApi.prediction(), drawnAt: onlineApi.localPlayerDrawnAt(), serverHasPlayerAt: window.__walk.simPosition(), entities: window.__novaland.snapshot().entities.length };
      });
      const metresApart = connection.drawnAt ? Math.hypot(connection.drawnAt.x - connection.serverHasPlayerAt.x, connection.drawnAt.y - connection.serverHasPlayerAt.y) : Infinity;
      results.push(check('online: still seated at the far corner, drawn where the server has the player, and the replica holds the player only', connection.status === 'online' && connection.malformedUpdates === 0 && metresApart < 0.01 && connection.entities === 1, `status ${connection.status}, ${metresApart.toFixed(4)} m apart, ${connection.entities} entity`));
      // Being seated at all means the page and the server hold the same map: the welcome carries its checksum and another is refused.
      // A correction is the server placing the player elsewhere than the page guessed; a turn applied a tick or two apart gives a small one (ADR 0012).
      const correctionLimit = (6 * content.speed) / 60;
      results.push(check(`online: the page predicted the player on the server's ground the whole way: no correction beyond six ticks of walking (${correctionLimit} m)`, connection.prediction?.predicting === true && connection.prediction.largestCorrectionMetres < correctionLimit, JSON.stringify(connection.prediction)));
    }
    report[mode] = {
      content,
      startTile,
      stops,
      routeMetres,
      seconds,
      machine: { loadAverage, cores: os.cpus().length },
      frames: { inClearing, inNewLand, chunkChangeFrames, framesRightAfterChunkChange: framesAfterChunkChange.length, lateRightAfterChunkChange: lateAfterChunkChange.length, lateFrames, walkerMsPerFrame: { clearing: meanOf(clearingFrames.map((frame) => frame.walkerMs)), newLand: meanOf(newLandFrames.map((frame) => frame.walkerMs)) }, messageHandlerMsPerFrame: { clearing: meanOf(clearingFrames.map((frame) => frame.messageHandlerMs)), newLand: meanOf(newLandFrames.map((frame) => frame.messageHandlerMs)) } },
      mostChunksDrawn: walk.mostChunksDrawn,
      framesMissingAChunk: walk.framesMissingAChunk,
      connection,
    };
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

/**
 * How long a list of frames took, in milliseconds: the median, the 99th
 * percentile and the longest time since the frame before, the frames per
 * second that comes to, and under `game` the same of the game's own work.
 */
function frameStatistics(frames) {
  const ascending = (numbers) => [...numbers].sort((first, second) => first - second);
  const spreadOf = (numbers) => (numbers.length === 0 ? { median: NaN, percentile99: NaN, longest: NaN } : { median: numbers[Math.floor(numbers.length / 2)], percentile99: numbers[Math.floor(numbers.length * 0.99)], longest: numbers[numbers.length - 1] });
  const totalMs = frames.reduce((sum, frame) => sum + frame.ms, 0);
  return { count: frames.length, ...spreadOf(ascending(frames.map((frame) => frame.ms))), framesPerSecond: (1000 * frames.length) / totalMs, game: spreadOf(ascending(frames.map((frame) => frame.gameMs))) };
}

function meanOf(numbers) {
  return numbers.length === 0 ? NaN : numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}
