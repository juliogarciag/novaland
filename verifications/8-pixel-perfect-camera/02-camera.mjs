/* global window, document */
/**
 * V2: the camera in a real browser. Starts `pnpm dev`, opens the page in Chromium
 * at several window sizes and pixel ratios, and reads the camera through
 * window.__novaland.camera(): the canvas backs at CSS size times devicePixelRatio,
 * the zoom is a whole number that shows at least the minimum metres, the camera
 * follows the player as it walks, stops at the level bounds and never shows
 * anything past them. Screenshots are the proof. Expected numbers come from the
 * level, the defs and the client's tuning through the debug API, never from this file.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5308;
const EPSILON = 1e-6;
const results = [];
const report = { viewports: [], walk: [] };
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  results.push(check('dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();

  // ---- Canvas size and zoom at two window sizes, at DPR 1 and 2 ----
  for (const { width, height, dpr } of [
    { width: 960, height: 720, dpr: 1 },
    { width: 1600, height: 900, dpr: 1 },
    { width: 960, height: 720, dpr: 2 },
    { width: 1600, height: 900, dpr: 2 },
  ]) {
    const label = `${width}x${height} @${dpr}x`;
    const page = await openPage(browser, { width, height, dpr });
    const view = await readView(page);
    report.viewports.push({ label, ...view });
    const MIN_VISIBLE_METRES = view.minVisibleMetres;
    const expectedZoom = Math.max(1, Math.floor(view.canvas.width / (view.pixelsPerMetre * MIN_VISIBLE_METRES)));
    results.push(check(`${label}: canvas backing store is CSS size x devicePixelRatio`, view.canvas.width === width * dpr && view.canvas.height === height * dpr && view.css.width === width && view.css.height === height, `${view.canvas.width}x${view.canvas.height} backing, ${view.css.width}x${view.css.height} css`));
    results.push(check(`${label}: zoom is a whole number`, Number.isInteger(view.camera.zoom) && view.camera.zoom >= 1, `zoom ${view.camera.zoom}`));
    results.push(check(`${label}: zoom is the largest that still shows ${MIN_VISIBLE_METRES} metres`, view.camera.zoom === expectedZoom && (view.camera.zoom === 1 || view.camera.visibleMetres.width >= MIN_VISIBLE_METRES), `${view.camera.visibleMetres.width.toFixed(2)} m visible, expected zoom ${expectedZoom}`));
    results.push(check(`${label}: the player is in the middle of the screen`, centred(view), `player ${fmt(view.player)} view centre ${fmt(centreOf(view.camera.worldView))}`));
    results.push(check(`${label}: nothing outside the level is shown`, insideBounds(view.camera)));
    await page.screenshot({ path: path.join(PROOF, `02-camera-${width}x${height}@${dpr}x.png`) });
    await page.context().close();
  }

  // ---- Resizing the window picks a new zoom and resizes the canvas ----
  {
    const page = await openPage(browser, { width: 960, height: 720, dpr: 1 });
    const before = await readView(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    const after = await readView(page);
    report.resize = { before, after };
    results.push(check('resizing the window resizes the canvas backing store', after.canvas.width === 1600 && after.canvas.height === 900, `${before.canvas.width}x${before.canvas.height} -> ${after.canvas.width}x${after.canvas.height}`));
    results.push(check('resizing the window recomputes the whole-number zoom', Number.isInteger(after.camera.zoom) && after.camera.zoom === Math.floor(1600 / (after.pixelsPerMetre * after.minVisibleMetres)) && after.camera.zoom !== before.camera.zoom, `zoom ${before.camera.zoom} -> ${after.camera.zoom}`));
    results.push(check('after the resize the player is still in the middle and the level still fills the screen', centred(after) && insideBounds(after.camera)));
    await page.context().close();
  }

  // ---- The pixel ratio changes while the page is open (window dragged to another screen) ----
  {
    const page = await openPage(browser, { width: 960, height: 720, dpr: 2 });
    const cdp = await page.context().newCDPSession(page);
    const show = async (width, height, dpr) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
      // Emulation does not fire the matchMedia change a real screen move does, so nudge the page the way a real move also does.
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(300);
      return readView(page);
    };
    const at2x = await readView(page);
    const at1x = await show(960, 720, 1);
    const resizedAt1x = await show(1000, 700, 1);
    const backAt2x = await show(1000, 700, 2);
    report.pixelRatioChange = { at2x, at1x, resizedAt1x, backAt2x };
    results.push(check('dropping to 1x halves the backing store and keeps the canvas the size of the window', at1x.dpr === 1 && at1x.canvas.width === 960 && at1x.canvas.height === 720 && at1x.css.width === 960 && at1x.css.height === 720, `${at2x.canvas.width}x${at2x.canvas.height} -> ${at1x.canvas.width}x${at1x.canvas.height} backing, css ${at1x.css.width}x${at1x.css.height}`));
    results.push(check('resizing the window at 1x keeps the canvas the size of the window', resizedAt1x.canvas.width === 1000 && resizedAt1x.canvas.height === 700 && resizedAt1x.css.width === 1000 && resizedAt1x.css.height === 700, `backing ${resizedAt1x.canvas.width}x${resizedAt1x.canvas.height}, css ${resizedAt1x.css.width}x${resizedAt1x.css.height}`));
    results.push(check('going back to 2x doubles the backing store again', backAt2x.dpr === 2 && backAt2x.canvas.width === 2000 && backAt2x.canvas.height === 1400 && backAt2x.css.width === 1000 && backAt2x.css.height === 700, `backing ${backAt2x.canvas.width}x${backAt2x.canvas.height}, css ${backAt2x.css.width}x${backAt2x.css.height}`));
    results.push(check('the zoom follows the pixel ratio and stays a whole number', at2x.camera.zoom === 6 && at1x.camera.zoom === 3 && resizedAt1x.camera.zoom === 3 && backAt2x.camera.zoom === 6, `${at2x.camera.zoom} -> ${at1x.camera.zoom} -> ${resizedAt1x.camera.zoom} -> ${backAt2x.camera.zoom}`));
    results.push(check('the player stays in the middle through pixel-ratio changes', [at1x, resizedAt1x, backAt2x].every((v) => centred(v) && insideBounds(v.camera))));
    await page.screenshot({ path: path.join(PROOF, '02-camera-pixel-ratio-back-to-2x.png') });
    await page.context().close();
  }

  // ---- The camera follows the player and stops at the bounds ----
  {
    const page = await openPage(browser, { width: 960, height: 720, dpr: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const content = await page.evaluate(() => {
      const api = window.__novaland;
      const player = api.defs.find((d) => d.name === 'player');
      return { level: api.level, speed: player.speed, radius: player.radius, pixelsPerMetre: api.pixelsPerMetre };
    });
    const { level, speed, radius, pixelsPerMetre } = content;
    const eastWall = level.walls.find((wall) => wall.height === level.height - 2 * wall.width && wall.x > 0);
    const northWall = level.walls.find((wall) => wall.width === level.width && wall.y < 0);
    const bounds = { x: (-level.width / 2) * pixelsPerMetre, y: (-level.height / 2) * pixelsPerMetre, width: level.width * pixelsPerMetre, height: level.height * pixelsPerMetre };
    const initial = await readView(page);
    results.push(check('the camera bounds are the level', sameRect(initial.camera.bounds, bounds), JSON.stringify(initial.camera.bounds)));
    results.push(check('the level is bigger than the screen, so the camera has to move', level.width > initial.camera.visibleMetres.width && level.height > initial.camera.visibleMetres.height, `${level.width}x${level.height} m level, ${initial.camera.visibleMetres.width}x${initial.camera.visibleMetres.height} m visible`));
    await page.screenshot({ path: path.join(PROOF, '02-camera-walk-1-spawn.png') });
    report.walk.push({ step: 'spawn', ...initial });

    // East for one second: the camera scrolls with the player and keeps it centred.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1000);
    const walking = await readView(page);
    report.walk.push({ step: 'walking east', ...walking });
    results.push(check('walking east scrolls the camera east', walking.camera.scrollX > initial.camera.scrollX + pixelsPerMetre, `scrollX ${initial.camera.scrollX} -> ${walking.camera.scrollX}`));
    results.push(check('the camera keeps the player in the middle while walking', centred(walking), `player ${fmt(walking.player)} view centre ${fmt(centreOf(walking.camera.worldView))}`));
    await page.screenshot({ path: path.join(PROOF, '02-camera-walk-2-east.png') });

    // Keep walking until the player is past the point where the camera must stop, but still short of the border wall.
    const cameraStopX = bounds.x + bounds.width - initial.camera.worldView.width / 2;
    const wallStopX = (eastWall.x - eastWall.width / 2 - radius) * pixelsPerMetre;
    const toCameraStopSeconds = (cameraStopX - walking.player.x) / pixelsPerMetre / speed;
    await page.waitForTimeout(Math.ceil(toCameraStopSeconds * 1000) + 600);
    const atEdge = await readView(page);
    report.walk.push({ step: 'camera at east edge, player still walking', ...atEdge, cameraStopX, wallStopX });
    results.push(check('the camera stops at the east edge of the level', nearly(rightOf(atEdge.camera.worldView), bounds.x + bounds.width), `view right ${rightOf(atEdge.camera.worldView)}, level right ${bounds.x + bounds.width}`));
    results.push(check('the player keeps walking past the middle once the camera has stopped', atEdge.player.x > centreOf(atEdge.camera.worldView).x + pixelsPerMetre && atEdge.player.x < wallStopX - pixelsPerMetre, `player ${fmt(atEdge.player)} view centre ${fmt(centreOf(atEdge.camera.worldView))}`));
    await page.waitForTimeout(300);
    const stillAtEdge = await readView(page);
    results.push(check('the camera no longer moves while the player walks on', stillAtEdge.camera.scrollX === atEdge.camera.scrollX && stillAtEdge.player.x > atEdge.player.x));
    await page.waitForTimeout(Math.ceil(((wallStopX - stillAtEdge.player.x) / pixelsPerMetre / speed) * 1000) + 500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    const blocked = await readView(page);
    report.walk.push({ step: 'blocked by the east wall', ...blocked });
    results.push(check('the east border wall still stops the player', blocked.player.x <= wallStopX + 0.2 && blocked.player.x > wallStopX - pixelsPerMetre * 0.2, `player x ${blocked.player.x.toFixed(2)} px, wall face ${wallStopX}`));
    await page.screenshot({ path: path.join(PROOF, '02-camera-walk-3-east-edge.png') });

    // North to the corner: the camera stops at the top edge too.
    await page.keyboard.down('KeyW');
    const wallStopY = (northWall.y + northWall.height / 2 + radius) * pixelsPerMetre;
    const toTopSeconds = (blocked.player.y - wallStopY) / pixelsPerMetre / speed;
    await page.waitForTimeout(Math.ceil(toTopSeconds * 1000) + 600);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(100);
    const corner = await readView(page);
    report.walk.push({ step: 'north-east corner', ...corner });
    results.push(check('walking north scrolls the camera north', corner.camera.scrollY < blocked.camera.scrollY - pixelsPerMetre, `scrollY ${blocked.camera.scrollY} -> ${corner.camera.scrollY}`));
    results.push(check('the camera stops at the north edge of the level', nearly(corner.camera.worldView.y, bounds.y), `view top ${corner.camera.worldView.y}, level top ${bounds.y}`));
    results.push(check('in the corner the camera is pinned on both axes', nearly(rightOf(corner.camera.worldView), bounds.x + bounds.width) && nearly(corner.camera.worldView.y, bounds.y)));
    await page.screenshot({ path: path.join(PROOF, '02-camera-walk-4-north-east-corner.png') });

    const samples = [initial, walking, atEdge, stillAtEdge, blocked, corner];
    results.push(check(`nothing outside the level was shown in any of ${samples.length} samples`, samples.every((s) => insideBounds(s.camera))));
    results.push(check('the view always starts on a whole device pixel (texture pixels never straddle screen pixels)', samples.every((s) => onDevicePixelGrid(s.camera))));
    results.push(check('the zoom stayed a whole number throughout', samples.every((s) => Number.isInteger(s.camera.zoom))));
    results.push(check('pixelArt and roundPixels are on', initial.pixelArt === true && initial.roundPixels === true));
    results.push(check('the HUD is drawn by its own scene, untouched by the world zoom', initial.hud.active && initial.hud.textCount === 1 && initial.hud.zoom === 1));
    results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
    report.errors = errors;
    await page.context().close();
  }
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('02-camera.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

async function openPage(browser, { width, height, dpr }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });
  return page;
}

/** Canvas, camera, drawn player and HUD, read in the same frame. */
function readView(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const world = api.game.scene.getScene('world');
    const hud = api.game.scene.getScene('hud');
    const circle = world.children.list.find((o) => o.type === 'Arc');
    return {
      tick: api.sim.tick,
      dpr: window.devicePixelRatio,
      canvas: { width: canvas.width, height: canvas.height },
      css: { width: rect.width, height: rect.height },
      pixelsPerMetre: api.pixelsPerMetre,
      minVisibleMetres: api.minVisibleMetres,
      camera: api.camera(),
      player: circle ? { x: circle.x, y: circle.y } : null,
      pixelArt: api.game.config.pixelArt,
      roundPixels: api.game.config.roundPixels,
      hud: { active: api.game.scene.isActive('hud'), textCount: hud ? hud.children.list.filter((o) => o.type === 'Text').length : 0, zoom: hud ? hud.cameras.main.zoom : null },
    };
  });
}

function nearly(a, b) {
  return Math.abs(a - b) < EPSILON;
}
function rightOf(rect) {
  return rect.x + rect.width;
}
function bottomOf(rect) {
  return rect.y + rect.height;
}
function centreOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
function fmt(point) {
  return point ? `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})` : 'none';
}
function sameRect(a, b) {
  return nearly(a.x, b.x) && nearly(a.y, b.y) && nearly(a.width, b.width) && nearly(a.height, b.height);
}

/** The drawn player sits at the centre of the view, give or take the device pixel the view is snapped to. */
function centred(view) {
  if (!view.player) return false;
  const centre = centreOf(view.camera.worldView);
  const tolerance = 1 / view.camera.zoom + EPSILON;
  return Math.abs(centre.x - view.player.x) <= tolerance && Math.abs(centre.y - view.player.y) <= tolerance;
}

function insideBounds(camera) {
  const { worldView, bounds } = camera;
  return worldView.x >= bounds.x - EPSILON && worldView.y >= bounds.y - EPSILON && rightOf(worldView) <= rightOf(bounds) + EPSILON && bottomOf(worldView) <= bottomOf(bounds) + EPSILON;
}

/** The world point at the view's top-left corner maps to a whole device pixel. */
function onDevicePixelGrid(camera) {
  const x = camera.worldView.x * camera.zoom;
  const y = camera.worldView.y * camera.zoom;
  return Math.abs(x - Math.round(x)) < 1e-6 && Math.abs(y - Math.round(y)) < 1e-6;
}
