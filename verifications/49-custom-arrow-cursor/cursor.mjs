/* global window, document, getComputedStyle, Image */
/**
 * Ticket 49: the mouse cursor over the running game is the pixel-art arrow.
 *
 * Starts `PORT=<n> pnpm dev`, opens the game in Chromium on an ordinary screen
 * and on a 2x one, and checks what a browser uses to draw the cursor: the
 * computed `cursor` of whatever is under the mouse, and the images it names,
 * pixel by pixel against the design in the generator. A browser screenshot
 * never contains the mouse cursor, so the pictures in ./proof are drawn from
 * the same served images: the arrow enlarged, and the arrow placed where the
 * mouse is over the game.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const { ARROW_CURSOR_CSS_SIZE, ARROW_CURSOR_FILES, ARROW_CURSOR_HOTSPOT, ARROW_CURSOR_PALETTE, ARROW_CURSOR_ROWS, ARROW_CURSOR_SCALE } = await import(
  path.join(ROOT, 'packages/client/tools/generate-arrow-cursor.mjs')
);

/** Not 5149: that one is the dev server left running for the human. */
const PORT = 5950;
const ORIGIN = `http://localhost:${PORT}`;
const VIEWPORT = { width: 960, height: 720 };
/** Where the mouse is put for the checks and for the picture, in CSS pixels. */
const MOUSE = { x: 480, y: 300 };
const results = [];
const report = { screens: {} };
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  for (const { name, devicePixelsPerCssPixel } of ARROW_CURSOR_FILES) {
    const screen = `${devicePixelsPerCssPixel}x screen`;
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: devicePixelsPerCssPixel });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });
    await page.mouse.move(MOUSE.x, MOUSE.y);

    // What is under the mouse, and the cursor the browser computed for it.
    const underMouse = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { tag: element?.tagName, cursor: element ? getComputedStyle(element).cursor : '' };
    }, MOUSE);
    // Chromium writes the `1x` of the stylesheet as `1dppx` in the computed value: the same resolution.
    const perScreen = ARROW_CURSOR_FILES.map((file) => `url("${ORIGIN}/cursors/${file.name}") ${file.devicePixelsPerCssPixel}dppx`).join(', ');
    const expectedCursor = `image-set(${perScreen}) ${ARROW_CURSOR_HOTSPOT.x * ARROW_CURSOR_SCALE} ${ARROW_CURSOR_HOTSPOT.y * ARROW_CURSOR_SCALE}, auto`;
    results.push(check(`${screen}: the game canvas is under the mouse`, underMouse.tag === 'CANVAS', underMouse.tag));
    results.push(check(`${screen}: its cursor is the arrow for each screen, clicking at the tip, with auto as the fallback`, underMouse.cursor === expectedCursor, underMouse.cursor));

    // The same cursor everywhere over the page, the far corner included.
    const cursorsAcrossThePage = await page.evaluate(({ width, height }) => {
      const cursors = new Set();
      for (let y = 0; y < height; y += 40) for (let x = 0; x < width; x += 40) cursors.add(getComputedStyle(document.elementFromPoint(x, y)).cursor);
      cursors.add(getComputedStyle(document.elementFromPoint(width - 1, height - 1)).cursor);
      return [...cursors];
    }, VIEWPORT);
    results.push(check(`${screen}: every point of the window has that cursor`, cursorsAcrossThePage.length === 1 && cursorsAcrossThePage[0] === expectedCursor, `${cursorsAcrossThePage.length} distinct`));

    // The image this screen picks: served, the right size, and the design pixel for pixel.
    const image = await page.evaluate(async (url) => {
      const picture = new Image();
      picture.src = url;
      await picture.decode();
      const canvas = document.createElement('canvas');
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(picture, 0, 0);
      return { width: picture.naturalWidth, height: picture.naturalHeight, rgba: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
    }, `${ORIGIN}/cursors/${name}`);
    const devicePixels = ARROW_CURSOR_CSS_SIZE * devicePixelsPerCssPixel;
    results.push(check(`${screen}: ${name} is ${devicePixels}x${devicePixels}, so ${ARROW_CURSOR_CSS_SIZE} CSS pixels on this screen`, image.width === devicePixels && image.height === devicePixels, `${image.width}x${image.height}`));
    const wrongPixels = pixelsOffTheDesign(image, ARROW_CURSOR_SCALE * devicePixelsPerCssPixel);
    results.push(check(`${screen}: every pixel of ${name} is its design pixel as one flat block (no smoothing)`, wrongPixels.length === 0, wrongPixels.slice(0, 3).join(' | ')));

    // A picture of it: the served image, placed with its hotspot on the mouse. The real cursor is never in a screenshot.
    await page.evaluate(
      ({ url, x, y, size }) => {
        const picture = document.createElement('img');
        picture.src = url;
        picture.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; width: ${size}px; height: ${size}px; pointer-events: none; z-index: 100;`;
        document.body.append(picture);
        return picture.decode();
      },
      { url: `${ORIGIN}/cursors/${name}`, x: MOUSE.x - ARROW_CURSOR_HOTSPOT.x * ARROW_CURSOR_SCALE, y: MOUSE.y - ARROW_CURSOR_HOTSPOT.y * ARROW_CURSOR_SCALE, size: ARROW_CURSOR_CSS_SIZE },
    );
    await page.screenshot({ path: path.join(PROOF, `over-the-game-${devicePixelsPerCssPixel}x.png`), clip: { x: MOUSE.x - 160, y: MOUSE.y - 100, width: 320, height: 240 } });
    report.screens[screen] = { underMouse, image: { name, width: image.width, height: image.height } };
    await page.close();
  }

  // The arrow enlarged, on the page's own background, straight from the served 1x file.
  const preview = await browser.newPage({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });
  await preview.goto(`${ORIGIN}/cursors/${ARROW_CURSOR_FILES[0].name}`);
  await preview.evaluate(() => {
    document.body.style.cssText = 'margin: 0; background: #0b0f14; display: flex; align-items: center; justify-content: center; height: 100vh;';
    document.querySelector('img').style.cssText = 'width: 256px; height: 256px; image-rendering: pixelated; background: none;';
  });
  await preview.screenshot({ path: path.join(PROOF, 'arrow-enlarged.png') });

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('cursor.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The pixels of a served image that are not the design's colour for the block they are in, as text. */
function pixelsOffTheDesign(image, blockSize) {
  const wrong = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const character = ARROW_CURSOR_ROWS[Math.floor(y / blockSize)]?.[Math.floor(x / blockSize)];
      const expected = ARROW_CURSOR_PALETTE[character] ? [...ARROW_CURSOR_PALETTE[character], 255] : [0, 0, 0, 0];
      const offset = (y * image.width + x) * 4;
      const actual = image.rgba.slice(offset, offset + 4);
      if (actual.join() !== expected.join()) wrong.push(`(${x}, ${y}) is ${actual.join()} not ${expected.join()}`);
    }
  }
  return wrong;
}
