/* global window, document, requestAnimationFrame */
/**
 * Measures what each zoom level costs on this machine's real graphics card:
 * the longest frame right after the wheel step (building what the new view
 * needs) and the frame times once it has settled. Not a check: it prints and
 * writes numbers, for the PR and for choosing how the far view is drawn.
 *
 * Usage: node measure.mjs <url> <proof file name> [css width] [css height] [pixel ratio]
 */
import { chromium } from 'playwright';
import { rememberCharacter, writeProof } from './lib.mjs';

const [url, proofName, width = '1440', height = '900', pixelRatio = '2'] = process.argv.slice(2);
if (!url || !proofName) throw new Error('usage: node measure.mjs <url> <proof file name> [css width] [css height] [pixel ratio]');
const SETTLE_MS = 1500;
const SAMPLE_MS = 3000;

// Headless Chromium draws in software unless told otherwise, and software says nothing about a real frame rate.
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: Number(pixelRatio) });
await rememberCharacter(context, { name: 'Measure', look: { skin: 0, hair: 0, clothes: 0, gender: 0, hairStyle: 0 } });
const page = await context.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.zoom(), null, { timeout: 30000 });
await page.mouse.move(Number(width) / 2, Number(height) / 2);

const graphics = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const { levels } = await page.evaluate(() => window.__novaland.zoom());
const rows = [];
for (let stepsOut = 0; stepsOut < levels.length; stepsOut += 1) {
  if (stepsOut > 0) await startWatchingFrames(page).then(() => page.mouse.wheel(0, 100));
  else await startWatchingFrames(page);
  await page.waitForTimeout(SETTLE_MS);
  const afterStep = await frameTimes(page);
  await startWatchingFrames(page);
  await page.waitForTimeout(SAMPLE_MS);
  const settled = await frameTimes(page);
  const state = await page.evaluate(() => {
    const api = window.__novaland;
    const terrain = api.terrain();
    const camera = api.camera();
    return { zoom: camera.zoom, tilesAcross: camera.visibleMetres.width, tilesDown: camera.visibleMetres.height, chunksDrawn: terrain.chunksDrawn.length, chunksInMap: terrain.chunksInMap, groundTiles: terrain.groundTiles, standingImages: terrain.standingImages, detail: terrain.detail };
  });
  rows.push({ stepsOut, ...state, longestFrameAfterStepMs: Math.round(Math.max(...afterStep)), framesPerSecond: Math.round(1000 / median(settled)), slowestSettledFrameMs: Math.round(Math.max(...settled)) });
  console.log(JSON.stringify(rows.at(-1)));
}
// And back in, in one go: the cost of rebuilding the near view.
await startWatchingFrames(page);
for (let step = 0; step < levels.length; step += 1) await page.mouse.wheel(0, -100).then(() => page.waitForTimeout(250));
await page.waitForTimeout(SETTLE_MS);
const backIn = { longestFrameMs: Math.round(Math.max(...(await frameTimes(page)))), zoom: await page.evaluate(() => window.__novaland.camera().zoom) };
console.log('back in:', JSON.stringify(backIn));
writeProof(proofName, { graphics, window: { width: Number(width), height: Number(height), pixelRatio: Number(pixelRatio) }, levels: rows, backIn });
console.log(`graphics: ${graphics}`);
await browser.close();

// ---- Helpers ----

function startWatchingFrames(page) {
  return page.evaluate(() => {
    window.__frameTimes = [];
    window.__watching = (window.__watching ?? 0) + 1;
    const watch = window.__watching;
    let last = performance.now();
    const tick = (now) => {
      if (window.__watching !== watch) return;
      window.__frameTimes.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function frameTimes(page) {
  return page.evaluate(() => window.__frameTimes.slice(1));
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}
