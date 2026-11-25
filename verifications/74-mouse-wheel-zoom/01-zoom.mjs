/* global window, document, requestAnimationFrame, Image */
/**
 * The mouse wheel zooms the world out and back in, in the real app.
 *
 * Runs on three maps: the Alps region of #70 (896x640 tiles, no trees), which
 * is what the ticket is for; the world itself, small enough that its
 * furthest zoom still draws the art; and a generated 400x300 map with trees
 * and rocks, so standing images go from art to colours and back. Every
 * expected number comes from the page: the zoom levels, the map's bounds,
 * the tile colours.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Not the port of the dev server left running for the human (5174). */
const MAPS = [
  { name: 'region', port: 5974, env: { VITE_REGION_MAP: 'alps' } },
  { name: 'world', port: 5975, env: {} },
  { name: 'generated', port: 5976, env: { VITE_GENERATED_MAP: '400x300' } },
];
/** CSS pixels at a pixel ratio of 2: a 2880x1800 canvas, a laptop's screen. */
const VIEWPORT = { width: 1440, height: 900 };
const PIXEL_RATIO = 2;
const CHARACTER = { name: 'Zoomer', look: { skin: 0, hair: 0, clothes: 0, gender: 0, hairStyle: 0 } };
/** Longer than the wheel's step interval (input/wheel.ts), so every turn of the wheel is a step. */
const BETWEEN_WHEEL_TURNS_MS = 300;
const results = [];
const report = {};

for (const map of MAPS) {
  const pageErrors = [];
  const devServer = start('pnpm', ['dev'], { env: { PORT: String(map.port), ...map.env } });
  let browser;
  try {
    const ready = (await waitForPort(map.port)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${map.port}/`), until: Boolean }).catch(() => false));
    results.push(check(`${map.name}: dev server up, started by this run`, ready, ready ? undefined : lastLinesOf(devServer.output)));
    if (!ready) throw new Error('nothing to open');

    // The machine's own graphics card: software rendering says nothing about a frame rate.
    browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: PIXEL_RATIO });
    await rememberCharacter(context, CHARACTER);
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
    await page.goto(`http://localhost:${map.port}/`);
    await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.zoom() && window.__novaland.drawnNames().length > 0, null, { timeout: 30000 });
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const graphics = await graphicsOf(page);
    const isRealGraphics = !/swiftshader|llvmpipe|software/i.test(graphics);

    // ---- The normal view ----
    const opening = await viewOf(page);
    const { levels } = opening.zoom;
    report[map.name] = { graphics, mapTiles: opening.mapTiles, levels, steps: [] };
    results.push(check(`${map.name}: opens at the normal view, a whole-number zoom`, opening.zoom.stepsOut === 0 && opening.camera.zoom === levels[0] && Number.isInteger(levels[0]), `zoom ${opening.camera.zoom}, levels ${levels.join(', ')}`));
    results.push(check(`${map.name}: the map is larger than the normal view, so there is something to zoom out to`, levels.length > 1, `${levels.length} levels`));
    results.push(check(`${map.name}: zooms of 1 and more are whole numbers and every level shows more than the one before`, levels.every((zoom, index) => (zoom < 1 || Number.isInteger(zoom)) && (index === 0 || zoom < levels[index - 1])), levels.join(', ')));
    await page.screenshot({ path: path.join(PROOF, `${map.name}-0-zoom-${label(levels[0])}.png`) });
    report[map.name].steps.push(summaryOf(opening));

    // ---- Wheel down, one level at a time ----
    let previous = opening;
    for (let stepsOut = 1; stepsOut < levels.length; stepsOut += 1) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(BETWEEN_WHEEL_TURNS_MS);
      const view = await viewOf(page);
      const expectedDetail = view.camera.zoom < view.nearestZoomDrawnAsArt ? 'colours' : 'art';
      results.push(check(`${map.name}: wheel down ${stepsOut}: zoom ${label(levels[stepsOut])}, more of the map on screen`, view.camera.zoom === levels[stepsOut] && view.zoom.stepsOut === stepsOut && view.tilesAcross > previous.tilesAcross, `${Math.round(view.tilesAcross)} x ${Math.round(view.tilesDown)} tiles, was ${Math.round(previous.tilesAcross)} across`));
      results.push(check(`${map.name}: wheel down ${stepsOut}: the camera is still on the player, as far as the map's edges allow`, isOnPlayer(view), `view x ${view.camera.worldView.x.toFixed(1)}, expected ${expectedViewStart(view, 'x').toFixed(1)}; y ${view.camera.worldView.y.toFixed(1)}, expected ${expectedViewStart(view, 'y').toFixed(1)}`));
      results.push(check(`${map.name}: wheel down ${stepsOut}: every chunk the view touches is drawn, as ${expectedDetail}`, view.terrain.detail === expectedDetail && view.chunksInViewNotDrawn.length === 0, `${view.terrain.chunksDrawn.length} of ${view.terrain.chunksInMap} chunks drawn, ${view.terrain.groundTiles} tilemap tiles, ${view.terrain.standingImages} standing images`));
      if (expectedDetail === 'colours') results.push(check(`${map.name}: wheel down ${stepsOut}: drawn as colours, a chunk is one image: no tilemap tile and no standing image is alive`, view.terrain.groundTiles === 0 && view.terrain.standingImages === 0));
      await page.screenshot({ path: path.join(PROOF, `${map.name}-${stepsOut}-zoom-${label(levels[stepsOut])}.png`) });
      report[map.name].steps.push(summaryOf(view));
      previous = view;
    }

    // ---- The furthest zoom ----
    const furthest = previous;
    const { worldView } = furthest.camera;
    const mapPixels = furthest.mapPixels;
    const wholeMapOnScreen = worldView.x <= mapPixels.x + 0.01 && worldView.y <= mapPixels.y + 0.01 && worldView.x + worldView.width >= mapPixels.x + mapPixels.width - 0.01 && worldView.y + worldView.height >= mapPixels.y + mapPixels.height - 0.01;
    results.push(check(`${map.name}: at the furthest zoom the whole map is on screen`, wholeMapOnScreen, `map ${furthest.mapTiles.width} x ${furthest.mapTiles.height} tiles, view ${Math.round(furthest.tilesAcross)} x ${Math.round(furthest.tilesDown)}`));
    results.push(check(`${map.name}: at the furthest zoom every chunk of the map is drawn`, furthest.terrain.chunksDrawn.length === furthest.terrain.chunksInMap, `${furthest.terrain.chunksDrawn.length} of ${furthest.terrain.chunksInMap}`));
    const emptyEachSide = { x: (worldView.width - mapPixels.width) / 2, y: (worldView.height - mapPixels.height) / 2 };
    results.push(check(`${map.name}: at the furthest zoom the map sits in the middle of the window`, Math.abs(mapPixels.x - worldView.x - emptyEachSide.x) <= 1 / furthest.camera.zoom && Math.abs(mapPixels.y - worldView.y - emptyEachSide.y) <= 1 / furthest.camera.zoom, `empty each side: ${Math.round(emptyEachSide.x * furthest.camera.zoom)} px across, ${Math.round(emptyEachSide.y * furthest.camera.zoom)} px down`));

    // What is on the screen is the map: tiles all over it have their def's colour where they should be. Only where the ground is drawn as colours; art is not one colour.
    if (furthest.terrain.detail === 'colours') {
      const painted = await tilesPaintedRight(page, furthest);
      results.push(check(`${map.name}: at the furthest zoom, tiles sampled all over the map are on screen in the right place and colour`, painted.sampled >= 40 && painted.right / painted.sampled >= 0.97, `${painted.right} of ${painted.sampled} sampled tiles`));
      report[map.name].tilesSampled = painted;
    }

    const frames = await frameTimesOver(page, 3000);
    const framesPerSecond = Math.round(1000 / median(frames));
    report[map.name].furthest = { zoom: furthest.camera.zoom, chunksDrawn: furthest.terrain.chunksDrawn.length, chunksInMap: furthest.terrain.chunksInMap, framesPerSecond, slowestFrameMs: Math.round(Math.max(...frames)), graphics };
    // A frame rate is only a fact about a real graphics card; in software it is written down and not judged.
    results.push(check(`${map.name}: the furthest zoom holds a playable frame rate${isRealGraphics ? '' : ' (software rendering: recorded, not judged)'}`, !isRealGraphics || framesPerSecond >= 50, `${framesPerSecond} fps, slowest frame ${Math.round(Math.max(...frames))} ms, on ${graphics}`));

    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(BETWEEN_WHEEL_TURNS_MS);
    const pastTheEnd = await viewOf(page);
    results.push(check(`${map.name}: one more turn down at the furthest zoom changes nothing`, pastTheEnd.camera.zoom === furthest.camera.zoom && pastTheEnd.zoom.stepsOut === levels.length - 1));

    // ---- Zoomed out, the game goes on: the player walks and the camera follows ----
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(BETWEEN_WHEEL_TURNS_MS);
    const beforeWalk = await viewOf(page);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(200);
    const afterWalk = await viewOf(page);
    results.push(check(`${map.name}: zoomed out, holding D still walks the player east and the camera stays on them`, afterWalk.player.x > beforeWalk.player.x + afterWalk.pixelsPerMetre && isOnPlayer(afterWalk) && afterWalk.camera.zoom === beforeWalk.camera.zoom, `player went ${((afterWalk.player.x - beforeWalk.player.x) / afterWalk.pixelsPerMetre).toFixed(1)} tiles east at zoom ${label(afterWalk.camera.zoom)}`));

    // ---- Wheel up, back to the normal view ----
    for (let turn = 0; turn < levels.length + 1; turn += 1) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(BETWEEN_WHEEL_TURNS_MS);
    }
    const back = await viewOf(page);
    results.push(check(`${map.name}: wheel up returns to the normal view and stops there`, back.camera.zoom === levels[0] && back.zoom.stepsOut === 0 && Math.abs(back.tilesAcross - opening.tilesAcross) < 0.01, `zoom ${back.camera.zoom}, ${back.tilesAcross} tiles across`));
    results.push(check(`${map.name}: back in the normal view the ground is its art again and only the chunks near the view are alive`, back.terrain.detail === 'art' && back.chunksInViewNotDrawn.length === 0 && back.terrain.chunksDrawn.length <= back.mostChunksNearView, `${back.terrain.chunksDrawn.length} chunks drawn, at most ${back.mostChunksNearView} near this view`));
    results.push(check(`${map.name}: zooming sent the sim nothing: the player only moved by the walk`, Math.abs(back.player.y - opening.player.y) < 1 && back.player.x >= opening.player.x, `player moved ${((back.player.x - opening.player.x) / back.pixelsPerMetre).toFixed(1)} tiles east, ${((back.player.y - opening.player.y) / back.pixelsPerMetre).toFixed(2)} south`));
    await page.screenshot({ path: path.join(PROOF, `${map.name}-back-in-zoom-${label(levels[0])}.png`) });
    results.push(check(`${map.name}: no page errors`, pageErrors.length === 0, pageErrors.join(' | ')));
  } catch (error) {
    results.push(check(`${map.name}: run completed (${error.message})`, false));
  } finally {
    await browser?.close();
    devServer.stop();
  }
}

report.results = results;
writeProof('01-zoom.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Everything a check needs about what is on screen, read from the page in one go. */
function viewOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const camera = api.camera();
    const terrain = api.terrain();
    const { bounds } = api.tiles;
    const pixelsPerMetre = api.pixelsPerMetre;
    const chunkPixels = api.chunkSize * pixelsPerMetre;
    const mapPixels = { x: bounds.column * pixelsPerMetre, y: bounds.row * pixelsPerMetre, width: bounds.width * pixelsPerMetre, height: bounds.height * pixelsPerMetre };
    const { worldView } = camera;
    // The chunks of the map the view touches, from the map itself.
    const drawn = new Set(terrain.chunksDrawn);
    const chunksInViewNotDrawn = api.tiles.chunks
      .filter((chunk) => chunk.column * chunkPixels < worldView.x + worldView.width && (chunk.column + 1) * chunkPixels > worldView.x && chunk.row * chunkPixels < worldView.y + worldView.height && (chunk.row + 1) * chunkPixels > worldView.y)
      .map((chunk) => `${chunk.column},${chunk.row}`)
      .filter((key) => !drawn.has(key));
    const kept = (length) => Math.ceil((length + 2 * terrain.keepMarginTiles * pixelsPerMetre) / chunkPixels) + 1;
    const localName = api.characters().find((character) => character.name === 'Zoomer');
    const drawnName = api.drawnNames().find((name) => name.eid === localName?.eid);
    return {
      camera,
      zoom: api.zoom(),
      terrain,
      mapTiles: bounds,
      mapPixels,
      pixelsPerMetre,
      // render/terrainDetail.ts: the art is drawn down to a zoom of 1/2. The one number here the page does not expose.
      nearestZoomDrawnAsArt: 0.5,
      tilesAcross: camera.visibleMetres.width,
      tilesDown: camera.visibleMetres.height,
      chunksInViewNotDrawn,
      mostChunksNearView: kept(worldView.width) * kept(worldView.height),
      // The name is drawn above the player, at the player's x.
      player: { x: drawnName.x, y: drawnName.y },
    };
  });
}

function summaryOf(view) {
  return { zoom: view.camera.zoom, tilesAcross: view.tilesAcross, tilesDown: view.tilesDown, detail: view.terrain.detail, chunksDrawn: view.terrain.chunksDrawn.length, chunksInMap: view.terrain.chunksInMap, tilemapTiles: view.terrain.groundTiles, standingImages: view.terrain.standingImages };
}

/** Where the view starts along an axis when it is centred on the player and kept inside the map; a view larger than the map has the map in its middle. */
function expectedViewStart(view, axis) {
  const length = axis === 'x' ? 'width' : 'height';
  const viewLength = view.camera.worldView[length];
  const mapStart = view.mapPixels[axis];
  const mapLength = view.mapPixels[length];
  if (viewLength >= mapLength) return mapStart - (viewLength - mapLength) / 2;
  return Math.min(Math.max(view.player[axis] - viewLength / 2, mapStart), mapStart + mapLength - viewLength);
}

function isOnPlayer(view) {
  // Across: within a device pixel. Down: the name floats above the player's feet, so within three tiles.
  const acrossOff = Math.abs(view.camera.worldView.x - expectedViewStart(view, 'x'));
  const downOff = Math.abs(view.camera.worldView.y - expectedViewStart(view, 'y'));
  return acrossOff <= 1 / view.camera.zoom + 0.01 && downOff <= 3 * view.pixelsPerMetre;
}

/**
 * Looks at a screenshot for a grid of tiles all over the map: each one's middle must show its def's colour.
 * Tiles under the HUD lines, the minimap, the button and the player are left out, and so are tiles with art
 * taller or more varied than a colour (this is only asked where the ground is drawn as colours).
 */
async function tilesPaintedRight(page, view) {
  const screenshot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ screenshot, zoom, worldView, pixelRatio }) => {
      const api = window.__novaland;
      const image = new Image();
      image.src = `data:image/png;base64,${screenshot}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const covered = [...document.querySelectorAll('button')].map((button) => button.getBoundingClientRect()).map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      const minimap = api.minimap();
      if (minimap) covered.push({ x: minimap.rect.x - 4, y: minimap.rect.y - 4, width: minimap.rect.width + 8, height: minimap.rect.height + 8 });
      // The HUD lines: the top-left corner. The player and their name: the middle of what the camera looks at is found below.
      covered.push({ x: 0, y: 0, width: 420, height: 130 });
      const names = api.drawnNames();
      const { bounds } = api.tiles;
      const colourOf = new Map(api.defs.map((def) => [def.id, def.color]));
      let sampled = 0;
      let right = 0;
      const wrong = [];
      for (let stepDown = 0; stepDown < 12; stepDown += 1) {
        for (let stepAcross = 0; stepAcross < 16; stepAcross += 1) {
          const tile = { column: bounds.column + Math.floor(((stepAcross + 0.5) * bounds.width) / 16), row: bounds.row + Math.floor(((stepDown + 0.5) * bounds.height) / 12) };
          const defId = api.tileDefIdAt(tile);
          if (defId === undefined) continue;
          const centre = api.tileCentre(tile);
          const devicePixel = { x: Math.floor((centre.x * api.pixelsPerMetre - worldView.x) * zoom), y: Math.floor((centre.y * api.pixelsPerMetre - worldView.y) * zoom) };
          const css = { x: devicePixel.x / pixelRatio, y: devicePixel.y / pixelRatio };
          if (covered.some((rect) => css.x >= rect.x && css.x <= rect.x + rect.width && css.y >= rect.y && css.y <= rect.y + rect.height)) continue;
          if (names.some((name) => Math.abs((name.x - worldView.x) * zoom - devicePixel.x) < 120 && Math.abs((name.y - worldView.y) * zoom - devicePixel.y) < 80)) continue;
          const [red, green, blue] = context.getImageData(devicePixel.x, devicePixel.y, 1, 1).data;
          const expected = colourOf.get(defId);
          sampled += 1;
          if (((red << 16) | (green << 8) | blue) === expected) right += 1;
          else wrong.push({ tile, expected: expected.toString(16), seen: ((red << 16) | (green << 8) | blue).toString(16) });
        }
      }
      return { sampled, right, wrong: wrong.slice(0, 5) };
    },
    { screenshot, zoom: view.camera.zoom, worldView: view.camera.worldView, pixelRatio: PIXEL_RATIO },
  );
}

function graphicsOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
}

/** The time between frames, in milliseconds, for every frame of the next `durationMs`. */
function frameTimesOver(page, durationMs) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const times = [];
        const startedAt = performance.now();
        let last = startedAt;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          if (now - startedAt < duration) requestAnimationFrame(tick);
          else resolve(times.slice(1));
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** A zoom as a file name and a sentence can carry it: 9, 1-2, 1-4, 0.176. */
function label(zoom) {
  if (zoom >= 1) return String(zoom);
  return Number.isInteger(1 / zoom) ? `1-${1 / zoom}` : zoom.toFixed(3);
}
