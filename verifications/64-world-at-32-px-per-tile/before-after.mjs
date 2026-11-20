/* global window */
/**
 * #64 before and after: the same screen, the same character, the same spot,
 * once on the commit this branch was cut from (16-pixel art) and once on
 * this branch (32-pixel art).
 *
 * Checks out the base commit into a temporary worktree under .worktrees/
 * (removed at the end), runs both clients and opens both at 1280x800, and
 * compares what a player sees: how many device pixels a metre, a tree and
 * the player take on screen, and how many metres the camera shows. They
 * must be the same; only the art inside them has twice the pixels. Both
 * screenshots go into proof/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const BEFORE_PORT = 5267;
const AFTER_PORT = 5268;
const VIEWPORT = { width: 1280, height: 800 };
const CHARACTER = { name: 'Same Spot', look: { skin: 2, hair: 3, clothes: 1 } };
const BASELINE = path.join(ROOT, '.worktrees', '64-baseline-16px');
const results = [];
const report = {};
const pageErrors = [];

const baseCommit = git(['merge-base', 'HEAD', 'origin/main']);
report.baseCommit = baseCommit;
let before;
let after;
let browser;
try {
  if (!existsSync(BASELINE)) git(['worktree', 'add', '--detach', BASELINE, baseCommit]);
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: BASELINE, stdio: 'ignore' });
  before = start('pnpm', ['dev'], { cwd: BASELINE, env: { PORT: String(BEFORE_PORT) } });
  after = start('pnpm', ['dev'], { env: { PORT: String(AFTER_PORT) } });
  const ready = await Promise.all(
    [
      [before, BEFORE_PORT],
      [after, AFTER_PORT],
    ].map(async ([server, port]) => (await waitForPort(port)) && (await waitFor(`the ready line on ${port}`, { read: () => server.output.includes(`localhost:${port}/`), until: Boolean }).catch(() => false))),
  );
  results.push(check(`both clients up: ${baseCommit.slice(0, 7)} (before) and this branch (after)`, ready.every(Boolean), ready.every(Boolean) ? undefined : `${lastLinesOf(before.output)} | ${lastLinesOf(after.output)}`));
  if (!ready.every(Boolean)) throw new Error('nothing to open');

  browser = await chromium.launch();
  const seenBefore = await screenOf(BEFORE_PORT, 'before-16px-1280x800.png');
  const seenAfter = await screenOf(AFTER_PORT, 'after-32px-1280x800.png');
  report.before = seenBefore;
  report.after = seenAfter;

  results.push(check('the art went from 16 to 32 pixels per metre', seenBefore.pixelsPerMetre === 16 && seenAfter.pixelsPerMetre === 32, `${seenBefore.pixelsPerMetre} -> ${seenAfter.pixelsPerMetre}`));
  for (const [what, describe] of [
    ['devicePixelsPerMetre', 'a metre takes as many device pixels on screen'],
    ['visibleMetres', 'the camera shows as many metres across'],
    ['tree', 'a tree is as big on screen'],
    ['rock', 'a rock is as big on screen'],
    ['player', 'the player is as big on screen'],
    ['nameLetterPixel', 'a pixel of a name is as big on screen'],
    ['playerAt', 'the player stands at the same spot on screen'],
  ]) {
    const [was, now] = [JSON.stringify(seenBefore[what]), JSON.stringify(seenAfter[what])];
    results.push(check(describe, was === now, `${was} before, ${now} after`));
  }
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  before?.stop();
  after?.stop();
  try {
    git(['worktree', 'remove', '--force', BASELINE]);
  } catch {
    /* never added */
  }
}

report.results = results;
writeProof('before-after.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Opens a client at the spawn, keeps a screenshot, and reads the on-screen size, in device pixels, of what a player sees. */
async function screenOf(port, screenshot) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, CHARACTER);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${port}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${port}: ${message.text()}`));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 30 && window.__novaland.drawnNames().length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(PROOF, screenshot) });
  const seen = await page.evaluate(() => {
    const api = window.__novaland;
    const camera = api.camera();
    const scene = api.game.scene.getScene('world');
    const onScreen = (object) => object && { width: object.displayWidth * camera.zoom, height: object.displayHeight * camera.zoom };
    const objects = scene.children.list;
    const name = api.drawnNames()[0];
    const sprite = objects.find((object) => object.type === 'Sprite' && object.texture.key === name.textureKey);
    const label = objects.find((object) => object.type === 'Text' && object.text === name.name);
    const view = camera.worldView;
    return {
      pixelsPerMetre: api.pixelsPerMetre,
      devicePixelsPerMetre: camera.zoom * api.pixelsPerMetre,
      visibleMetres: camera.visibleMetres,
      tree: onScreen(objects.find((object) => object.type === 'Image' && object.texture.key === 'tree')),
      rock: onScreen(objects.find((object) => object.type === 'Image' && object.texture.key === 'rock')),
      player: onScreen(sprite),
      nameLetterPixel: label && parseFloat(label.style.fontSize) / 8,
      playerAt: { x: Math.round((sprite.x - view.x) * camera.zoom), y: Math.round((sprite.y - view.y) * camera.zoom) },
    };
  });
  await context.close();
  return seen;
}
