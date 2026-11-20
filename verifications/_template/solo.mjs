/* global window */
/**
 * Solo template: starts `PORT=<n> pnpm dev`, opens the page in Chromium, reads
 * the sim through `window.__novaland`, presses a key, and writes a screenshot
 * and a JSON report into ./proof.
 *
 * The three checks below only show the moves (read state, send input, compare).
 * Replace them with what your ticket promises, and derive every expected number
 * from the debug API (map, tiles, defs, camera) instead of hardcoding it.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** A port no other session uses, and not the one of the dev server you leave running for the human. */
const PORT = 5901;
/** CSS pixels; the page opens at a pixel ratio of 1 so screen, device and CSS pixels agree. */
const VIEWPORT = { width: 960, height: 720 };
/** Who the page plays as: the browser remembers this character, so the creator screen does not show. Palette and shape indexes, as the sim's `characterPalettes` and `characterShapes` list them. */
const CHARACTER = { name: 'Template', look: { skin: 0, hair: 0, clothes: 0, gender: 0, hairStyle: 0 } };
const results = [];
const report = {};
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  // The ready line proves the port is this run's server, not something that was already listening there.
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, CHARACTER);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });

  // Read: the local player as the sim has it.
  const before = await localPlayerOf(page);
  results.push(check('the sim is running and holds the local player', before.player !== undefined, `tick ${before.tick}, slot ${before.slot}`));

  // Send input the way a person does, then read again.
  await page.keyboard.down('KeyD');
  const walking = await waitFor('the sim sees D held', { read: () => localPlayerOf(page), until: (state) => state.player?.components.MoveIntent.x > 0 }).catch(() => undefined);
  await page.keyboard.up('KeyD');
  results.push(check('holding D reaches the sim as a move east', walking !== undefined, walking && JSON.stringify(walking.player.components.MoveIntent)));

  await page.screenshot({ path: path.join(PROOF, 'solo.png') });
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
  report.before = before;
  report.walking = walking;
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('solo.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The tick, the local seat and that seat's entity as the snapshot has it. */
function localPlayerOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    return { tick: api.sim.tick, slot, player };
  });
}
