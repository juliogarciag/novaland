/* global window, document */
/**
 * V2: solo mode is unchanged. `pnpm dev` with no VITE_SERVER_URL boots the
 * local sim: no connection screen, no online status, a live sim that ticks
 * and a player that walks on a key press. Then the browser verification of
 * ticket #21 (random avatars, the dev J key and the debug hooks that seat
 * extra players) is run as it is against this branch.
 */
import { chromium } from 'playwright';
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROOF, ROOT, check, run, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5312;
const results = [];
const report = {};
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT), VITE_SERVER_URL: undefined } });
let browser;
try {
  results.push(check('solo dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 20000 });
  const solo = await page.evaluate(() => {
    const api = window.__novaland;
    const hud = api.game.scene.getScene('hud').children.list[0];
    const player = api.snapshot().entities.find((entity) => entity.components.Player);
    return {
      screen: document.getElementById('screen'),
      online: api.online,
      isReplica: api.sim.isReplica,
      tick: api.sim.tick,
      localSlot: api.localSlot(),
      hud: hud ? hud.text : null,
      playerSlot: player ? player.components.Player.slot : null,
      x: player ? player.components.Position.x : null,
    };
  });
  report.solo = solo;
  results.push(check('no connection screen exists in solo mode', solo.screen === null));
  results.push(check('no online status is exposed in solo mode', solo.online === undefined));
  results.push(check('window.__novaland.sim is a live sim (not a replica) that ticks', solo.isReplica !== true && solo.tick > 10, `tick ${solo.tick}`));
  results.push(check('the local player sits in seat 0, like before', solo.localSlot === 0 && solo.playerSlot === 0));
  results.push(check('the HUD shows the controls and the tick, and no online counter', /WASD.*tick \d+/.test(solo.hud) && !/online/.test(solo.hud), solo.hud));
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const after = await page.evaluate(() => window.__novaland.snapshot().entities.find((entity) => entity.components.Player).components.Position.x);
  results.push(check('holding D walks the player east through the local sim', after > solo.x + 0.5, `${solo.x.toFixed(2)} -> ${after.toFixed(2)}`));
  await page.screenshot({ path: path.join(PROOF, '02-solo-after-walk.png') });
  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}

// The existing browser verification of #21 (random avatars, every sheet drawn, the dev J key), unchanged, against this
// branch. It writes into its own proof folder, which this ticket must not change: that folder is set aside first and
// put back as it was, whatever happens. #10's script is not rerun any more: it looks up a def named `player`, which
// #21 replaced with one def per avatar, so it fails on main itself; #21's script checks the sprites in its place.
for (const { ticket, folder } of [{ ticket: '#21', folder: '21-random-avatar-spread-spawns' }]) {
  const rerun = await rerunBrowserVerification(folder);
  const summary = rerun.output.split('\n').find((line) => /CHECKS (PASSED|FAILED)/.test(line));
  results.push(check(`ticket ${ticket}'s browser verification still passes on this branch`, rerun.code === 0 && /ALL \d+ CHECKS PASSED/.test(rerun.output), summary));
  report[folder] = { code: rerun.code, summary };
}

writeProof('02-solo.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Runs `verifications/<folder>/03-browser.mjs` in solo mode, copies its screenshots here, and leaves its own proof folder as it was. */
async function rerunBrowserVerification(folder) {
  const dir = path.join(ROOT, 'verifications', folder);
  const proof = path.join(dir, 'proof');
  const setAside = path.join(os.tmpdir(), `novaland-${folder}-proof-${process.pid}`);
  cpSync(proof, setAside, { recursive: true });
  const prefix = folder.split('-')[0];
  try {
    if (!existsSync(path.join(dir, 'node_modules'))) await run('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile'], { cwd: dir });
    const rerun = await run('node', ['03-browser.mjs'], { cwd: dir, env: { VITE_SERVER_URL: undefined } });
    writeProof(`02-solo-${folder}.txt`, rerun.output);
    for (const file of readdirSync(proof).filter((name) => name.startsWith('03-browser') && name.endsWith('.png'))) {
      copyFileSync(path.join(proof, file), path.join(PROOF, `02-solo-${prefix}-${file}`));
    }
    return rerun;
  } finally {
    rmSync(proof, { recursive: true, force: true });
    cpSync(setAside, proof, { recursive: true });
    rmSync(setAside, { recursive: true, force: true });
  }
}
