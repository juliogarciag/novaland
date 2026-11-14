/* global window, document, getComputedStyle, Image */
/**
 * Ticket 49: the mouse cursor over the running game is a pixel-art arrow, and
 * the C key switches between the designs.
 *
 * Starts `PORT=<n> pnpm dev`, opens the game in Chromium on an ordinary screen
 * and on a 2x one, and checks what a browser uses to draw the cursor: the
 * computed `cursor` of whatever is under the mouse, and the images it names,
 * pixel by pixel against the designs in the generator. It presses C once per
 * design and checks each in turn, then reloads to see the last one kept.
 *
 * A browser screenshot never contains the mouse cursor, so the pictures in
 * ./proof are drawn from the same served images, placed where the mouse is
 * over the game. Chromium only: Firefox and Safari are not checked.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const { CURSOR_CSS_SIZE, CURSOR_DESIGNS, CURSOR_SCALE, CURSOR_SCREENS, cursorFileName } = await import(path.join(ROOT, 'packages/client/tools/generate-cursors.mjs'));

/** Not 5149: that one is the dev server left running for the human. */
const PORT = 5950;
const ORIGIN = `http://localhost:${PORT}`;
const VIEWPORT = { width: 960, height: 720 };
/** Where the mouse is put for the checks and for the pictures, in CSS pixels. */
const MOUSE = { x: 480, y: 300 };
/** The key that switches cursors, as the player presses it. */
const NEXT_CURSOR_KEY = 'KeyC';
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
  for (const screen of CURSOR_SCREENS) {
    const label = `${screen.devicePixelsPerCssPixel}x screen`;
    // A context of its own: nothing remembered from the other screen.
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: screen.devicePixelsPerCssPixel });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
    await openGame(page);
    report.screens[label] = [];

    // The first design shows on its own; each press of the key shows the next, and one more comes back to the first.
    for (const [index, design] of [...CURSOR_DESIGNS, CURSOR_DESIGNS[0]].entries()) {
      if (index > 0) await page.keyboard.press(NEXT_CURSOR_KEY);
      const cursors = await cursorsAcrossThePage(page);
      const when = index === 0 ? 'on opening the game' : index === CURSOR_DESIGNS.length ? `after ${index} presses of C, back at the start` : `after ${index} ${index === 1 ? 'press' : 'presses'} of C`;
      const shown = cursors.underMouseTag === 'CANVAS' && cursors.distinct.length === 1 && cursors.distinct[0] === expectedCursor(design);
      results.push(check(`${label}: ${when}, every point of the window shows ${design.name}, clicking at its hotspot, with auto as the fallback`, shown, cursors.distinct.join(' ; ')));
      if (index === CURSOR_DESIGNS.length) break;

      // The image this screen picks for the design: served, the right size, and the design pixel for pixel.
      const name = cursorFileName(design.name, screen);
      const image = await servedImage(page, `${ORIGIN}/cursors/${name}`);
      const devicePixels = CURSOR_CSS_SIZE * screen.devicePixelsPerCssPixel;
      const wrongPixels = pixelsOffTheDesign(image, design, CURSOR_SCALE * screen.devicePixelsPerCssPixel);
      const asDesigned = image.width === devicePixels && image.height === devicePixels && wrongPixels.length === 0;
      results.push(check(`${label}: ${name} is ${devicePixels}x${devicePixels} (${CURSOR_CSS_SIZE} CSS pixels) and every pixel is its design pixel as one flat block`, asDesigned, `${image.width}x${image.height}${wrongPixels.length ? `, ${wrongPixels.slice(0, 3).join(' | ')}` : ''}`));

      // A picture of it: the served image, placed with its hotspot on the mouse. The real cursor is never in a screenshot.
      await page.evaluate(
        ({ url, x, y, size }) => {
          const picture = document.createElement('img');
          picture.id = 'cursor-picture';
          picture.src = url;
          picture.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; width: ${size}px; height: ${size}px; pointer-events: none; z-index: 100;`;
          document.body.append(picture);
          return picture.decode();
        },
        { url: `${ORIGIN}/cursors/${name}`, x: MOUSE.x - design.hotspot.x * CURSOR_SCALE, y: MOUSE.y - design.hotspot.y * CURSOR_SCALE, size: CURSOR_CSS_SIZE },
      );
      await page.screenshot({ path: path.join(PROOF, `${design.name}-over-the-game-${screen.devicePixelsPerCssPixel}x.png`), clip: { x: MOUSE.x - 160, y: MOUSE.y - 100, width: 320, height: 240 } });
      await page.evaluate(() => document.getElementById('cursor-picture')?.remove());
      report.screens[label].push({ design: design.name, cursor: cursors.distinct[0], image: { name, width: image.width, height: image.height } });
    }

    // What the player picked is still there after a reload; a shortcut that includes the key picks nothing.
    await page.keyboard.press(NEXT_CURSOR_KEY);
    await page.keyboard.press(`Control+${NEXT_CURSOR_KEY}`);
    await openGame(page);
    const afterReload = await cursorsAcrossThePage(page);
    const kept = afterReload.distinct.length === 1 && afterReload.distinct[0] === expectedCursor(CURSOR_DESIGNS[1]);
    results.push(check(`${label}: the picked cursor (${CURSOR_DESIGNS[1].name}) survives a reload, and Ctrl+C did not switch it`, kept, afterReload.distinct.join(' ; ')));
    await context.close();
  }

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

async function openGame(page) {
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });
  await page.mouse.move(MOUSE.x, MOUSE.y);
}

/** The computed `cursor` Chromium reports for a design. It writes the `1x` of the stylesheet as `1dppx`: the same resolution. */
function expectedCursor(design) {
  const perScreen = CURSOR_SCREENS.map((screen) => `url("${ORIGIN}/cursors/${cursorFileName(design.name, screen)}") ${screen.devicePixelsPerCssPixel}dppx`).join(', ');
  return `image-set(${perScreen}) ${design.hotspot.x * CURSOR_SCALE} ${design.hotspot.y * CURSOR_SCALE}, auto`;
}

/** What is under the mouse, and the distinct computed cursors of a 40-pixel grid of points over the window, the far corner included. */
function cursorsAcrossThePage(page) {
  return page.evaluate(
    ({ mouse, viewport }) => {
      const distinct = new Set();
      for (let y = 0; y < viewport.height; y += 40) for (let x = 0; x < viewport.width; x += 40) distinct.add(getComputedStyle(document.elementFromPoint(x, y)).cursor);
      distinct.add(getComputedStyle(document.elementFromPoint(viewport.width - 1, viewport.height - 1)).cursor);
      return { underMouseTag: document.elementFromPoint(mouse.x, mouse.y)?.tagName, distinct: [...distinct] };
    },
    { mouse: MOUSE, viewport: VIEWPORT },
  );
}

/** The size and the RGBA bytes of an image as the dev server serves it. */
function servedImage(page, url) {
  return page.evaluate(async (source) => {
    const picture = new Image();
    picture.src = source;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(picture, 0, 0);
    return { width: picture.naturalWidth, height: picture.naturalHeight, rgba: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
  }, url);
}

/** The pixels of a served image that are not the design's colour for the block they are in, as text. */
function pixelsOffTheDesign(image, design, blockSize) {
  const wrong = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const color = design.palette[design.rows[Math.floor(y / blockSize)]?.[Math.floor(x / blockSize)]];
      const expected = color ? [color[0], color[1], color[2], color[3] ?? 255] : [0, 0, 0, 0];
      const offset = (y * image.width + x) * 4;
      const actual = image.rgba.slice(offset, offset + 4);
      // A see-through pixel comes back from a canvas with its colour rounded by the alpha; an opaque or empty one comes back exact.
      const tolerance = expected[3] > 0 && expected[3] < 255 ? 3 : 0;
      if (actual.some((value, channel) => Math.abs(value - expected[channel]) > tolerance)) wrong.push(`(${x}, ${y}) is ${actual.join()} not ${expected.join()}`);
    }
  }
  return wrong;
}
