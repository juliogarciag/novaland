/* global window, requestAnimationFrame */
/**
 * V2: the HUD in the real client (plain `pnpm dev`, solo), in Chromium.
 * The tick counter and the movement help are gone, the rest is kept; the
 * text sits on a semi-transparent backdrop that has the text's size at every
 * pixel ratio and after resizes; the text keeps a readable contrast over the
 * lightest tile (dirt), the darkest (trees) and plain white; the frame rate
 * shown is the rate the page really renders at, also when frames get slow;
 * and solo there is no latency.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { MIN_CONTRAST, hudNumbers, hudOf, luminance, measureHudPixels, playerPosition, tilesUnderHud, waitForHud, walkTo } from './hud.mjs';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const CLIENT_PORT = 5350;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = {};
const pageErrors = [];
const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: undefined } });
let browser;
try {
  results.push(check('client dev server up (solo: no VITE_SERVER_URL)', await waitForPort(CLIENT_PORT)));
  browser = await chromium.launch();
  const open = async (pixelRatio, viewport = VIEWPORT) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: pixelRatio });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://localhost:${CLIENT_PORT}/`);
    await page.waitForFunction(() => window.__novaland?.camera() !== undefined, undefined, { timeout: 20000 });
    return page;
  };
  /** The HUD and its pixels in a screenshot, once the frame rate has been counted (so the text has its final width). */
  const capture = async (page, name) => {
    await waitForHud(page, /^fps +\d+/);
    // The screenshot and the box must be of the same frame's text: read, shoot, read again and retry if the HUD changed in between.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const hud = await hudOf(page);
      const screenshot = await page.screenshot(name ? { path: path.join(PROOF, name) } : {});
      const after = await hudOf(page);
      if (JSON.stringify(after.box) === JSON.stringify(hud.box)) return { hud, pixels: measureHudPixels(screenshot, hud) };
    }
    throw new Error('the HUD box kept changing between screenshots');
  };

  // 1. What the HUD says.
  const page = await open(1);
  const first = await waitForHud(page, /^fps +\d+/);
  const text = first.lines.join(' | ');
  results.push(check('the tick counter is gone', !/tick/i.test(text), text));
  results.push(check('the movement help is gone', !/WASD|arrows|to move/i.test(text), text));
  results.push(check('solo shows the frame rate alone on the first line: no latency, no seats', /^fps +\d+$/.test(first.lines[0]), first.lines[0]));
  const ownName = await page.evaluate(() => {
    const api = window.__novaland;
    const own = api.snapshot().entities.find((entity) => entity.components.Player && entity.components.Player.slot === api.localSlot());
    return api.defs.find((def) => def.id === own.components.DefRef.id).name;
  });
  results.push(check('who you are and the player count are kept', first.lines[1] === `you: ${ownName}   players: 1`, first.lines[1]));
  results.push(check('the dev J hint is kept', first.lines[2] === 'J: seat another player (dev)' && first.lines.length === 3, first.lines[2]));
  await page.keyboard.press('KeyJ');
  const afterJ = await waitForHud(page, /^fps/).then(async () => {
    await page.waitForFunction(() => window.__novaland.game.scene.getScene('hud').children.list[0].text.includes('players: 2'), undefined, { timeout: 5000 });
    return hudOf(page);
  });
  results.push(check('the player count still follows the world: J seats a second player', /players: 2$/.test(afterJ.lines[1]), afterJ.lines[1]));
  report.lines = { first: first.lines, afterJ: afterJ.lines };

  // 2. The backdrop: there, semi-transparent, and the size of the text at every pixel ratio and window size.
  results.push(check('the text has a semi-transparent background colour and padding', /^rgba\(.+,\s*0\.\d+\)$/.test(first.backgroundColor) && first.padding.left > 0 && first.padding.top > 0, `${first.backgroundColor}, padding ${JSON.stringify(first.padding)}`));
  const sizes = [];
  for (const { pixelRatio, viewport } of [
    { pixelRatio: 1, viewport: VIEWPORT },
    { pixelRatio: 2, viewport: VIEWPORT },
    { pixelRatio: 3, viewport: VIEWPORT },
    { pixelRatio: 1.5, viewport: { width: 1280, height: 800 } },
  ]) {
    const sized = await open(pixelRatio, viewport);
    const { hud, pixels } = await capture(sized, `02-hud-ratio-${pixelRatio}.png`);
    sizes.push({ pixelRatio, viewport, ...describe(hud, pixels) });
    await sized.context().close();
  }
  // The same page, resized: the canvas is rebuilt and the HUD must follow without a reload.
  const resized = await open(2);
  for (const viewport of [{ width: 640, height: 480 }, { width: 1400, height: 900 }]) {
    await resized.setViewportSize(viewport);
    await resized.waitForFunction((width) => window.__novaland.game.canvas.width === width * window.devicePixelRatio, viewport.width, { timeout: 5000 });
    await resized.waitForTimeout(300);
    const { hud, pixels } = await capture(resized, `02-hud-resized-${viewport.width}x${viewport.height}.png`);
    sizes.push({ pixelRatio: 2, viewport, resized: true, ...describe(hud, pixels) });
  }
  await resized.context().close();
  report.sizes = sizes;
  const reference = sizes[0];
  for (const size of sizes) {
    const label = `pixel ratio ${size.pixelRatio}, ${size.viewport.width}x${size.viewport.height}${size.resized ? ' after a resize' : ''}`;
    results.push(check(`${label}: the box sits at the margin and has the same CSS size as at ratio 1`, close(size.css.x, reference.css.x, 0.5) && close(size.css.y, reference.css.y, 0.5) && close(size.css.width, reference.css.width, 2.5) && close(size.css.height, reference.css.height, 2.5), JSON.stringify(size.css)));
    results.push(check(`${label}: the backdrop surrounds the text on every side by the padding`, size.textPixels > 200 && size.textInset.left >= size.cssPadding.left - 1.5 && size.textInset.top >= size.cssPadding.top - 1.5 && size.textInset.right >= size.cssPadding.left - 1.5 && size.textInset.bottom >= size.cssPadding.top - 1.5 && size.textInset.left <= size.cssPadding.left + 3, `text inset ${JSON.stringify(size.textInset)} CSS px, padding ${JSON.stringify(size.cssPadding)}`));
    results.push(check(`${label}: the whole band around the text is backdrop, contrast >= ${MIN_CONTRAST}`, size.contrast >= MIN_CONTRAST, `${size.contrast}:1`));
  }

  // 3. Legible over the lightest tile, the darkest tile and plain white.
  const grid = await page.evaluate(() => ({ width: window.__novaland.grid.width, height: window.__novaland.grid.height }));
  // Which tiles are the lightest and the darkest comes from the level's own defs, not from this script.
  const tileColors = await page.evaluate(() => {
    const api = window.__novaland;
    const defIds = new Set(api.grid.defIds.flat());
    return api.defs.filter((def) => defIds.has(def.id)).map((def) => ({ name: def.name, color: def.color }));
  });
  const byLuminance = tileColors.map(({ name, color }) => ({ name, luminance: luminance([(color >> 16) & 255, (color >> 8) & 255, color & 255]) })).sort((one, other) => one.luminance - other.luminance);
  const darkestTile = byLuminance[0].name;
  const lightestTile = byLuminance[byLuminance.length - 1].name;
  report.tiles = byLuminance;
  // East along the path the spawn is on, to the north-south path in the middle of the level.
  await walkTo(page, { axis: 'x', target: 21 - grid.width / 2 });
  // Then south until the HUD box is centred on the two rows of the east-west path (rows 14 and 15, whose shared edge is y = 0).
  const camera = await page.evaluate(() => window.__novaland.camera());
  const boxNow = (await hudOf(page)).box;
  const pixelsPerMetre = await page.evaluate(() => window.__novaland.pixelsPerMetre);
  const targetY = (camera.height / 2 - (boxNow.y + boxNow.height / 2)) / camera.zoom / pixelsPerMetre;
  await walkTo(page, { axis: 'y', target: targetY });
  await page.waitForTimeout(300);
  const overLightTiles = await tilesUnderHud(page);
  const light = await capture(page, '02-hud-over-light-tiles.png');
  results.push(check(`the HUD is over ${lightestTile}, the lightest tile of the level, and nothing else`, Object.keys(overLightTiles).join() === lightestTile, JSON.stringify(overLightTiles)));
  results.push(check(`over dirt the text contrast is >= ${MIN_CONTRAST} (without the backdrop it would be ${light.pixels.contrastWithoutBackdrop})`, light.pixels.contrast >= MIN_CONTRAST && light.pixels.contrastWithoutBackdrop < MIN_CONTRAST, `${light.pixels.contrast}:1`));
  // North to the top of the level: the camera stops at the level's edge and the HUD covers the tree line.
  await walkTo(page, { axis: 'y', target: -grid.height / 2 });
  await page.waitForTimeout(300);
  const overDarkTiles = await tilesUnderHud(page);
  const dark = await capture(page, '02-hud-over-dark-tiles.png');
  results.push(check(`the HUD is over ${darkestTile}, the darkest tile of the level, and nothing else`, Object.keys(overDarkTiles).join() === darkestTile, `${JSON.stringify(overDarkTiles)}, player at ${JSON.stringify(await playerPosition(page))}`));
  results.push(check(`over trees the text contrast is >= ${MIN_CONTRAST}`, dark.pixels.contrast >= MIN_CONTRAST, `${dark.pixels.contrast}:1`));
  results.push(check('the backdrop is see-through: it is lighter over dirt than over trees, and darker than the tiles around it both times', luminanceOf(light.pixels.ringMean) > luminanceOf(dark.pixels.ringMean) && luminanceOf(light.pixels.ringMean) < luminanceOf(light.pixels.surroundingsMean) && luminanceOf(dark.pixels.ringMean) < luminanceOf(dark.pixels.surroundingsMean), `over dirt rgb(${light.pixels.ringMean}) next to rgb(${light.pixels.surroundingsMean}); over trees rgb(${dark.pixels.ringMean}) next to rgb(${dark.pixels.surroundingsMean})`));
  // The worst any tile could be: a white sheet over the whole world, under the HUD.
  await page.evaluate(() => {
    const scene = window.__novaland.game.scene.getScene('world');
    scene.add.rectangle(0, 0, 100000, 100000, 0xffffff).setDepth(1e9).setName('verification-white');
  });
  await page.waitForTimeout(200);
  const white = await capture(page, '02-hud-over-white.png');
  results.push(check(`over plain white the text contrast is still >= ${MIN_CONTRAST} (without the backdrop it would be ${white.pixels.contrastWithoutBackdrop})`, white.pixels.contrast >= MIN_CONTRAST && white.pixels.surroundingsMean.every((value) => value >= 250), `${white.pixels.contrast}:1`));
  await page.evaluate(() => window.__novaland.game.scene.getScene('world').children.getByName('verification-white').destroy());
  report.legibility = { overLightTiles, light: light.pixels, overDarkTiles, dark: dark.pixels, white: white.pixels };

  // 4. The frame rate is the one the page really renders at, and it follows when frames get slow.
  const steady = await framesAndHud(page, 3000);
  results.push(check('the fps shown is the rate the page renders at', Math.abs(steady.hudFps - steady.measuredFps) <= Math.max(3, steady.measuredFps * 0.08), `HUD ${steady.hudFps}, page rendered ${steady.measuredFps.toFixed(1)} frames per second`));
  // Burn 40 ms in every frame: the display cannot be served at its rate any more.
  await page.evaluate(() => {
    window.__burn = true;
    const burn = () => {
      if (!window.__burn) return;
      const until = performance.now() + 40;
      while (performance.now() < until);
      requestAnimationFrame(burn);
    };
    requestAnimationFrame(burn);
  });
  await page.waitForTimeout(2500);
  const slow = await framesAndHud(page, 3000);
  results.push(check('with 40 ms of work in every frame the fps shown drops to what is really rendered', slow.measuredFps < steady.measuredFps * 0.6 && Math.abs(slow.hudFps - slow.measuredFps) <= Math.max(3, slow.measuredFps * 0.15), `HUD ${slow.hudFps}, page rendered ${slow.measuredFps.toFixed(1)} frames per second`));
  await page.evaluate(() => {
    window.__burn = false;
  });
  await page.waitForTimeout(2500);
  const recovered = await framesAndHud(page, 2000);
  results.push(check('and it comes back when the work stops', recovered.hudFps > slow.hudFps * 1.5 && Math.abs(recovered.hudFps - recovered.measuredFps) <= Math.max(3, recovered.measuredFps * 0.08), `HUD ${recovered.hudFps}, page rendered ${recovered.measuredFps.toFixed(1)} frames per second`));
  report.frameRate = { steady, slow, recovered };

  // 5. View facts stay out of the sim.
  const snapshotText = await page.evaluate(() => JSON.stringify(window.__novaland.snapshot()));
  results.push(check('nothing about fps or latency is in the sim snapshot', !/fps|latency|frameRate|ping/i.test(snapshotText)));
  results.push(check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; ')));
} catch (error) {
  results.push(check('the script ran to the end', false, String(error?.stack ?? error)));
} finally {
  await browser?.close();
  client.stop();
}
writeProof('02-hud.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function close(value, expected, tolerance) {
  return Math.abs(value - expected) <= tolerance;
}

function luminanceOf([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The HUD box, padding and text extent in CSS pixels, with the measured contrast. */
function describe(hud, pixels) {
  const ratio = hud.pixelRatio;
  const boxWidth = pixels.box.right - pixels.box.left;
  const boxHeight = pixels.box.bottom - pixels.box.top;
  return {
    lines: hud.lines,
    css: { x: hud.box.x / ratio, y: hud.box.y / ratio, width: hud.box.width / ratio, height: hud.box.height / ratio },
    cssPadding: { left: hud.padding.left / ratio, top: hud.padding.top / ratio },
    textPixels: pixels.textPixels,
    textInset: {
      left: pixels.textExtent.left / ratio,
      top: pixels.textExtent.top / ratio,
      right: (boxWidth - 1 - pixels.textExtent.right) / ratio,
      bottom: (boxHeight - 1 - pixels.textExtent.bottom) / ratio,
    },
    contrast: pixels.contrast,
    ringMean: pixels.ringMean,
  };
}

/** Counts the page's own animation frames for `milliseconds` and reads the HUD's fps at the end. */
async function framesAndHud(page, milliseconds) {
  const measuredFps = await page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let frames = 0;
        let startedAt;
        const count = (now) => {
          if (startedAt === undefined) startedAt = now;
          else frames += 1;
          if (now - startedAt >= duration) resolve((frames * 1000) / (now - startedAt));
          else requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
      }),
    milliseconds,
  );
  return { measuredFps, hudFps: hudNumbers(await hudOf(page)).fps };
}
