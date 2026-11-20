/* global window, document */
/**
 * Online template: starts the real room server and a client pointed at it,
 * opens two tabs in Chromium, reads each tab's replica and connection through
 * `window.__novaland`, and writes screenshots and a JSON report into ./proof.
 *
 * The checks below only show the moves (wait for a seat, read the replica in
 * two tabs, compare). Replace them with what your ticket promises.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Ports no other session uses, and not the ones of the servers you leave running for the human. */
const SERVER_PORT = 5902;
const CLIENT_PORT = 5903;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = {};
const pageErrors = [];

const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT) } });
const devServer = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let browser;
try {
  // The boot line and the ready line prove both ports are this run's servers, not something that was already listening there.
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  const bootLine = portsUp && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean }).catch(() => undefined));
  const clientReady = portsUp && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  const ready = Boolean(bootLine) && clientReady;
  results.push(check('room server and dev server up, both started by this run', ready, ready ? bootLine : `${lastLinesOf(roomServer.output)} | ${lastLinesOf(devServer.output)}`));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();

  // One tab, one seat.
  const tabA = await openTab('A');
  const alone = await seatedStateOf(tabA);
  results.push(check('A is seated and its replica holds its own player', alone.status.kind === 'online' && alone.screen === null && alone.slots.includes(alone.status.slot), JSON.stringify(alone)));

  // A second tab is a second player: both replicas agree on who is in the world.
  const tabB = await openTab('B');
  const together = await waitFor('both tabs see two players', {
    read: async () => ({ stateA: await seatedStateOf(tabA), stateB: await seatedStateOf(tabB) }),
    until: ({ stateA, stateB }) => stateA.slots.length === 2 && stateB.slots.length === 2,
  }).catch(() => undefined);
  const sameWorld = together !== undefined && together.stateA.status.slot !== together.stateB.status.slot && together.stateA.slots.join() === together.stateB.slots.join();
  results.push(check('B gets another seat and both tabs see the same two players', sameWorld, together && `A ${JSON.stringify(together.stateA.slots)}, B ${JSON.stringify(together.stateB.slots)}`));

  await tabA.screenshot({ path: path.join(PROOF, 'online-A.png') });
  await tabB.screenshot({ path: path.join(PROOF, 'online-B.png') });
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
  report.alone = alone;
  report.together = together;
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  roomServer.stop();
  devServer.stop();
}

report.results = results;
writeProof('online.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** A tab of its own browser context (its own player, a character named after the tab), open on the client and seated in the world. */
async function openTab(name) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // The browser remembers a character, so the creator screen does not show. Palette and shape indexes, as the sim's `characterPalettes` and `characterShapes` list them.
  await rememberCharacter(context, { name: `Tab ${name}`, look: { skin: 0, hair: 0, clothes: 0, body: 0, hairStyle: 0 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${name}: ${message.text()}`));
  await page.goto(`http://localhost:${CLIENT_PORT}/`);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 15000 });
  return page;
}

/** The connection status, the connection screen on show (null when playing) and the seats taken in the tab's replica. */
function seatedStateOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const screen = document.getElementById('screen');
    const slots = api.snapshot().entities.filter((entity) => entity.components.Player).map((entity) => entity.components.Player.slot);
    return { status: api.online.status(), screen: screen && !screen.hidden ? screen.dataset.screen : null, slots: slots.sort((slot, other) => slot - other) };
  });
}
