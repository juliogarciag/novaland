/* global window */
/**
 * V5: the vertical slice in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium, holds real keys and checks the sim state exposed on window.__novaland:
 * the player moves at the def speed, stops against walls, slides along them, and
 * what is drawn matches what the sim says. Screenshots are the proof.
 * Expected numbers come from the sim's own level and defs, read through the debug API.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5303;
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

  // Content the expectations are derived from.
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const player = api.defs.find((d) => d.name === 'player');
    return { level: api.level, speed: player.speed, radius: player.radius, ppm: api.pixelsPerMetre };
  });
  const { level, speed: SPEED, radius: RADIUS, ppm: PPM } = content;
  const inner = level.walls.filter(
    (wall) => Math.abs(wall.x) + wall.width / 2 < level.width / 2 - 0.5 && Math.abs(wall.y) + wall.height / 2 < level.height / 2 - 0.5,
  );
  const tallWall = inner.find((wall) => wall.height > wall.width);
  const northWall = level.walls.find((wall) => wall.width === level.width && wall.y < 0);
  const stopX = tallWall.x - tallWall.width / 2 - RADIUS;
  const northStopY = northWall.y + northWall.height / 2 + RADIUS;
  report.content = { ...content, tallWall, northWall, stopX, northStopY };

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
  results.push(check('player spawned at the level spawn point', initial.x === level.spawn.x && initial.y === level.spawn.y));
  results.push(check('every wall and the player exist in the sim', initial.entities === level.walls.length + 1, `${initial.entities} entities`));
  report.steps.push({ step: 'initial', ...initial });

  // Hold S for half a second: moves down, into the row of the tall inner wall, nowhere near anything.
  const down = await hold(['KeyS'], 500);
  results.push(check('S moves the player down only', down.after.y > down.from.y + 1 && down.after.x === down.from.x, `y=${down.after.y.toFixed(2)}`));
  results.push(check('the player is level with the tall inner wall', down.after.y > tallWall.y - tallWall.height / 2 + RADIUS && down.after.y < tallWall.y + tallWall.height / 2 - RADIUS));

  // Hold ArrowRight for 600 ms: travels SPEED * held ticks / 60 metres (plus or minus a frame of input latency), ending well short of the wall.
  const right = await hold(['ArrowRight'], 600);
  const heldTicks = right.to.tick - right.from.tick;
  const expected = (SPEED * heldTicks) / 60;
  const travelled = right.after.x - right.from.x;
  results.push(check('ArrowRight moves the player right at the def speed', Math.abs(travelled - expected) < 0.25 && travelled > 2 && right.after.x < stopX - 1, `${travelled.toFixed(2)}m over ${heldTicks} ticks, expected ${expected.toFixed(2)}m`));
  results.push(check('the player moves only on the x axis', right.after.y === right.from.y));
  const idle = await state();
  await page.waitForTimeout(300);
  results.push(check('releasing the key stops the player', (await state()).x === idle.x));
  report.steps.push({ step: 'right-1s', ...right.after, travelled, expected, heldTicks });

  // Keep pushing right: the player hits the tall inner wall and stays at its face.
  const push = await hold(['ArrowRight'], 2500);
  await page.screenshot({ path: path.join(PROOF, '05-browser-2-blocked-by-wall.png') });
  results.push(check('a wall stops the player (Rapier collision)', push.to.x <= stopX + 0.01 && push.to.x > stopX - 0.2, `x=${push.to.x.toFixed(3)}, stop at ${stopX.toFixed(2)}`));
  results.push(check('the player stays put while still pushing into the wall', Math.abs(push.after.x - push.to.x) < 0.01));
  report.steps.push({ step: 'blocked', ...push.after, stopX });

  // Push diagonally into the wall: slides along it.
  const slide = await hold(['ArrowRight', 'ArrowDown'], 600);
  results.push(check('pushing diagonally slides along the wall', slide.after.y > push.after.y + 1 && slide.after.x <= stopX + 0.01, `y ${push.after.y.toFixed(2)} -> ${slide.after.y.toFixed(2)}`));
  report.steps.push({ step: 'slide', ...slide.after });

  // Walk back to open space and up to the border, however far it is: the border wall must hold.
  await hold(['KeyA'], 800);
  const beforeNorth = await state();
  const north = await hold(['KeyW'], Math.ceil(((beforeNorth.y - northStopY) / SPEED) * 1000) + 500);
  await page.screenshot({ path: path.join(PROOF, '05-browser-3-at-north-border.png') });
  results.push(check('the north border wall holds', north.after.y > northStopY - 0.01 && north.after.y < northStopY + 0.2, `y=${north.after.y.toFixed(3)}, stop at ${northStopY.toFixed(2)}`));
  report.steps.push({ step: 'north', ...north.after, northStopY });

  // What is drawn matches the sim: the player circle sits where the sim says, in pixels, in every sample taken.
  const samples = [initial, down.after, right.after, push.after, slide.after, north.after];
  const matches = samples.every((s) => s.drawn && Math.abs(s.drawn.x - s.x * PPM) < 1e-6 && Math.abs(s.drawn.y - s.y * PPM) < 1e-6);
  results.push(check(`the rendered player matches the sim position (${PPM} px/m) in ${samples.length} samples`, matches, JSON.stringify(north.after.drawn)));
  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('05-browser.json', report);
process.exit(summarize(results) ? 0 : 1);
