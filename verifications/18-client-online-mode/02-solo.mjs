/* global window, document */
/**
 * V2: solo mode is unchanged. `pnpm dev` with no VITE_SERVER_URL boots the
 * local sim: no connection screen, no online status, a live sim that ticks
 * and a player that walks on a key press. Then the browser verification of
 * ticket #10 (the player sprite) is run as it is against this branch, since
 * every existing verification must keep passing.
 */
import { chromium } from 'playwright';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
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

// The existing browser verification of #10, unchanged, against this branch.
const tenDir = path.join(ROOT, 'verifications/10-player-sprite');
if (!existsSync(path.join(tenDir, 'node_modules'))) await run('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile'], { cwd: tenDir });
const ten = await run('node', ['03-browser.mjs'], { cwd: tenDir, env: { VITE_SERVER_URL: undefined } });
writeProof('02-solo-10-player-sprite.txt', ten.output);
for (const file of readdirSync(path.join(tenDir, 'proof')).filter((name) => name.startsWith('03-browser') && name.endsWith('.png'))) {
  copyFileSync(path.join(tenDir, 'proof', file), path.join(PROOF, `02-solo-10-${file}`));
}
// Its run rewrote its own proof files; this ticket does not change #10's folder.
await run('git', ['checkout', '--', 'verifications/10-player-sprite/proof']);
const tenSummary = ten.output.split('\n').find((line) => /CHECKS (PASSED|FAILED)/.test(line));
results.push(check("ticket #10's browser verification still passes on this branch", ten.code === 0 && /ALL \d+ CHECKS PASSED/.test(ten.output), tenSummary));
report.tenPlayerSprite = { code: ten.code, summary: tenSummary };

writeProof('02-solo.json', report);
process.exit(summarize(results) ? 0 : 1);
