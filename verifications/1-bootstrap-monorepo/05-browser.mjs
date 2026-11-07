/* global window */
/**
 * V5: the vertical slice in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium, holds real keys and checks the sim state exposed on window.__novaland:
 * the player moves at the def speed, stops against walls, slides along them, and
 * what is drawn matches what the sim says. Screenshots are the proof.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5303;
const SPEED = 5;
const RADIUS = 0.4;
const PIXELS_PER_METRE = 32;
const results = [];
const report = { steps: [] };
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  results.push(check('dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });

  /** Sim state and the drawn player, read in the same frame. */
  const state = () =>
    page.evaluate(() => {
      const s = window.__novaland.snapshot();
      const p = s.entities.find((e) => e.components.Player);
      const scene = window.__novaland.game.scene.getScene('world');
      const circle = scene.children.list.find((o) => o.type === 'Arc');
      return {
        tick: s.tick,
        x: p.components.Position.x,
        y: p.components.Position.y,
        entities: s.entities.length,
        drawn: circle ? { x: circle.x, y: circle.y } : null,
      };
    });
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    const from = await state();
    await page.waitForTimeout(ms);
    const to = await state();
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(100);
    return { from, to, after: await state() };
  };

  const canvasCount = await page.locator('canvas').count();
  results.push(check('Phaser canvas is on the page', canvasCount === 1));
  const initial = await state();
  await page.screenshot({ path: path.join(PROOF, '05-browser-1-initial.png') });
  results.push(check('player spawned at the level spawn point (0,0)', initial.x === 0 && initial.y === 0));
  results.push(check('walls and player exist in the sim', initial.entities === 8, `${initial.entities} entities`));
  report.steps.push({ step: 'initial', ...initial });

  // Hold ArrowRight for one second: travels SPEED * held ticks / 60 metres (plus or minus a frame of input latency).
  const right = await hold(['ArrowRight'], 1000);
  const heldTicks = right.to.tick - right.from.tick;
  const expected = (SPEED * heldTicks) / 60;
  const travelled = right.after.x - right.from.x;
  results.push(check('ArrowRight moves the player right at the def speed', Math.abs(travelled - expected) < 0.25 && travelled > 3, `${travelled.toFixed(2)}m over ${heldTicks} ticks, expected ${expected.toFixed(2)}m`));
  results.push(check('the player moves only on the x axis', right.after.y === right.from.y));
  const idle = await state();
  await page.waitForTimeout(300);
  results.push(check('releasing the key stops the player', (await state()).x === idle.x));
  report.steps.push({ step: 'right-1s', ...right.after, travelled, expected, heldTicks });

  // Step down a bit, then keep pushing right: the player hits the tall inner wall and stays at its face.
  await hold(['KeyS'], 500);
  const push = await hold(['ArrowRight'], 2500);
  await page.screenshot({ path: path.join(PROOF, '05-browser-2-blocked-by-wall.png') });
  const innerFace = 6 - 0.5; // wall { x: 6, w: 1 } in the starter level
  const stopX = innerFace - RADIUS;
  results.push(check('a wall stops the player (Rapier collision)', push.to.x <= stopX + 0.01 && push.to.x > stopX - 0.2, `x=${push.to.x.toFixed(3)}, stop at ${stopX}`));
  results.push(check('the player stays put while still pushing into the wall', Math.abs(push.after.x - push.to.x) < 0.01));
  report.steps.push({ step: 'blocked', ...push.after, innerFace });

  // Push diagonally into the wall: slides along it.
  const slide = await hold(['ArrowRight', 'ArrowDown'], 600);
  results.push(check('pushing diagonally slides along the wall', slide.after.y > push.after.y + 1 && slide.after.x <= stopX + 0.01, `y ${push.after.y.toFixed(2)} -> ${slide.after.y.toFixed(2)}`));
  report.steps.push({ step: 'slide', ...slide.after });

  // Walk back to open space and far up: the border wall must hold.
  await hold(['KeyA'], 800);
  const north = await hold(['KeyW'], 3000);
  await page.screenshot({ path: path.join(PROOF, '05-browser-3-at-north-border.png') });
  const northStopY = -8 + 1 + RADIUS; // level height 16, border thickness 1
  results.push(check('the north border wall holds', north.after.y > northStopY - 0.01 && north.after.y < northStopY + 0.2, `y=${north.after.y.toFixed(3)}, stop at ${northStopY}`));
  report.steps.push({ step: 'north', ...north.after });

  // What is drawn matches the sim: the player circle sits where the sim says, in pixels, in every sample taken.
  const samples = [initial, right.after, push.after, slide.after, north.after];
  const matches = samples.every((s) => s.drawn && Math.abs(s.drawn.x - s.x * PIXELS_PER_METRE) < 1e-6 && Math.abs(s.drawn.y - s.y * PIXELS_PER_METRE) < 1e-6);
  results.push(check(`the rendered player matches the sim position (${PIXELS_PER_METRE} px/m) in ${samples.length} samples`, matches, JSON.stringify(north.after.drawn)));
  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('05-browser.json', report);
process.exit(summarize(results) ? 0 : 1);
