/* global window, document, localStorage */
/**
 * #55: a player who quits and joins again stands where they left, also after
 * the server process is killed or stopped and started again; a browser with
 * no token is a new player; one token is never two players.
 *
 * Runs the real room server (positions on disk, in a scratch directory) and
 * the real client, and drives Chromium. One browser context is one browser
 * profile: its tabs share `localStorage`, so they share the player token.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5955;
const CLIENT_PORT = 5956;
const VIEWPORT = { width: 960, height: 720 };
const TOKEN_STORAGE_KEY = 'novaland.playerToken';
/** The room remembers a new player once they have held a seat this long, and saves walkers this often (packages/server/src/world/tuning.ts). The waits below are a little longer. */
const NEW_PLAYER_WAIT_MS = 11_000;
const SAVE_INTERVAL_WAIT_MS = 6_500;
const results = [];
const report = {};
const pageErrors = [];
const dataDirectory = mkdtempSync(path.join(tmpdir(), 'novaland-55-'));

let roomServer = startRoomServer();
const devServer = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let serverOutput = '';
let browser;
try {
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  const bootLine = portsUp && (await bootLineOf(roomServer));
  const clientReady = portsUp && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  const ready = Boolean(bootLine) && clientReady;
  results.push(check('room server (positions on disk) and dev server up, both started by this run', ready && bootLine.includes('"savedPositions":"disk"'), ready ? bootLine.replace(dataDirectory, '<scratch>') : `${lastLinesOf(roomServer.output)} | ${lastLinesOf(devServer.output)}`));
  if (!ready) throw new Error('nothing to open');
  const health = await (await fetch(`http://localhost:${SERVER_PORT}/health`)).json();
  results.push(check('/health says positions are kept on disk', health.savedPositions === 'disk', JSON.stringify(health)));

  browser = await chromium.launch();

  // ---- A new player walks somewhere ----
  const profileA = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  let tabA = await openTab(profileA, 'A');
  const seatedAt = Date.now();
  const spawned = await stateOf(tabA);
  results.push(check('A, a browser with no token, spawns next to the spawn tile', spawned.tilesFromSpawn <= 2, `${spawned.tilesFromSpawn} tiles from the spawn`));
  const tokenA = await tabA.evaluate((key) => localStorage.getItem(key), TOKEN_STORAGE_KEY);
  results.push(check('A now keeps a player token: 43 base64url characters', /^[A-Za-z0-9_-]{43}$/.test(tokenA ?? ''), `${(tokenA ?? '').length} characters`));
  const walked = await walk(tabA, 'd', 2500);
  results.push(check('A walks east, well away from the spawn', walked.tilesFromSpawn >= 5, `${walked.tilesFromSpawn} tiles from the spawn, at ${show(walked.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '01-walked-somewhere.png') });
  await sleep(Math.max(0, NEW_PLAYER_WAIT_MS - (Date.now() - seatedAt)));

  // ---- Closes the tab, opens it again ----
  await tabA.close();
  await waitFor('the server to see A leave', { read: seatsTaken, until: (taken) => taken === 0 });
  tabA = await openTab(profileA, 'A');
  const reopened = await stateOf(tabA);
  results.push(check('A closes the tab, opens it again and stands where they were', samePoint(reopened.position, walked.position), `left at ${show(walked.position)}, back at ${show(reopened.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '02-reopened-tab-same-place.png') });

  // ---- Another browser profile is another player ----
  const profileB = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const tabB = await openTab(profileB, 'B');
  const stranger = await stateOf(tabB);
  const tokenB = await tabB.evaluate((key) => localStorage.getItem(key), TOKEN_STORAGE_KEY);
  results.push(check('B, a second browser profile, has another token and spawns as a new player next to the spawn tile', tokenB !== tokenA && stranger.tilesFromSpawn <= 2 && stranger.slot !== reopened.slot, `${stranger.tilesFromSpawn} tiles from the spawn, seat ${stranger.slot}`));
  await waitFor('B to see both players', { read: () => stateOf(tabB), until: (state) => state.players === 2 });
  await tabB.screenshot({ path: path.join(PROOF, '03-second-profile-is-a-new-player.png') });
  await profileB.close();
  await waitFor('the server to see B leave', { read: seatsTaken, until: (taken) => taken === 1 });

  // ---- The server process crashes (SIGKILL): the last save, at most a few seconds old, is what comes back ----
  const beforeCrash = await walk(tabA, 's', 1500);
  await sleep(SAVE_INTERVAL_WAIT_MS);
  serverOutput += roomServer.output;
  roomServer.crash();
  await roomServer.exited;
  await waitFor('A to notice the server is gone', { read: () => stateOf(tabA), until: (state) => state.status !== 'online', timeoutMs: 20000 });
  await tabA.screenshot({ path: path.join(PROOF, '04-server-gone.png') });
  roomServer = startRoomServer();
  const crashBoot = (await waitForPort(SERVER_PORT)) && (await bootLineOf(roomServer));
  results.push(check('a new server process starts on the same data directory and finds one saved player', Boolean(crashBoot) && crashBoot.includes('"savedPlayers":1'), crashBoot ? crashBoot.replace(dataDirectory, '<scratch>') : lastLinesOf(roomServer.output)));
  const afterCrash = await waitFor('A to be seated again by itself', { read: () => stateOf(tabA), until: (state) => state.status === 'online' && state.position !== undefined, timeoutMs: 30000 });
  results.push(check('after the server process was killed and started again, A stands where they were', samePoint(afterCrash.position, beforeCrash.position), `before ${show(beforeCrash.position)}, after ${show(afterCrash.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '05-after-crash-same-place.png') });

  // ---- The server is stopped the way a deploy stops it (SIGTERM), right after A moved: the stop itself saves ----
  const beforeStop = await walk(tabA, 'a', 1200);
  serverOutput += roomServer.output;
  roomServer.stop();
  await roomServer.exited;
  roomServer = startRoomServer();
  await waitForPort(SERVER_PORT);
  await bootLineOf(roomServer);
  await waitFor('A to notice the stop', { read: () => stateOf(tabA), until: (state) => state.status !== 'online' || state.tick < beforeStop.tick, timeoutMs: 20000 }).catch(() => undefined);
  const afterStop = await waitFor('A to be seated again by itself', { read: () => stateOf(tabA), until: (state) => state.status === 'online' && state.position !== undefined && state.tick < beforeStop.tick, timeoutMs: 30000 });
  results.push(check('after the server was stopped as a deploy stops it, with no time for a periodic save, A stands where they were', samePoint(afterStop.position, beforeStop.position), `before ${show(beforeStop.position)}, after ${show(afterStop.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '06-after-restart-same-place.png') });

  // ---- The same token in a second tab: one player, the newest tab plays ----
  const secondTab = await openTab(profileA, 'A2');
  const replacedScreen = await waitFor('the first tab to be told it was replaced', { read: () => stateOf(tabA), until: (state) => state.screen === 'elsewhere' });
  const inSecondTab = await waitFor('the second tab to settle', { read: () => stateOf(secondTab), until: (state) => state.status === 'online' && state.players === 1 });
  results.push(check('a second tab of the same browser takes the player over: the first tab shows the "elsewhere" screen', replacedScreen.screen === 'elsewhere' && replacedScreen.status === 'elsewhere', replacedScreen.screenText));
  results.push(check('the world holds one player for that token, standing where they were', inSecondTab.players === 1 && (await seatsTaken()) === 1 && samePoint(inSecondTab.position, afterStop.position), `${inSecondTab.players} player, ${await seatsTaken()} seat taken, at ${show(inSecondTab.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '07-first-tab-elsewhere.png') });
  await sleep(3000);
  const stillWaiting = await stateOf(tabA);
  results.push(check('the replaced tab does not take the player back by itself', stillWaiting.screen === 'elsewhere' && (await stateOf(secondTab)).status === 'online', stillWaiting.screen));
  await tabA.getByRole('button', { name: 'Play here' }).click();
  const tookBack = await waitFor('the first tab to play again', { read: () => stateOf(tabA), until: (state) => state.status === 'online' && state.players === 1 });
  const secondTabAfter = await waitFor('the second tab to be replaced in turn', { read: () => stateOf(secondTab), until: (state) => state.screen === 'elsewhere' });
  results.push(check('"Play here" takes the player back: the first tab plays, the second shows "elsewhere", still one player in the same place', tookBack.players === 1 && secondTabAfter.screen === 'elsewhere' && (await seatsTaken()) === 1 && samePoint(tookBack.position, afterStop.position), `${tookBack.players} player at ${show(tookBack.position)}`));
  await tabA.screenshot({ path: path.join(PROOF, '08-first-tab-plays-again.png') });

  // ---- The token is a credential ----
  serverOutput += roomServer.output;
  results.push(check('the server never printed either token', !serverOutput.includes(tokenA) && !serverOutput.includes(tokenB), `${serverOutput.split('\n').length} lines of server output read`));
  const onDebugApi = await tabA.evaluate((token) => JSON.stringify(Object.keys(window.__novaland)).includes(token) || JSON.stringify(window.__novaland.snapshot()).includes(token) || JSON.stringify(window.__novaland.online.status()).includes(token), tokenA);
  results.push(check('the token is not in the world state a client holds nor on the debug API', onDebugApi === false));
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
  Object.assign(report, { spawned, walked, reopened, stranger, beforeCrash, afterCrash, beforeStop, afterStop, inSecondTab, tookBack });
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  roomServer.stop();
  devServer.stop();
  rmSync(dataDirectory, { recursive: true, force: true });
}

report.results = results;
writeProof('01-rejoin.json', JSON.parse(JSON.stringify(report).split(dataDirectory).join('<scratch>')));
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

function startRoomServer() {
  return start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT), DATA_DIRECTORY: dataDirectory } });
}

function bootLineOf(server) {
  return waitFor("the room server's boot line", { read: () => server.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean, timeoutMs: 20000 }).catch(() => undefined);
}

async function seatsTaken() {
  return (await (await fetch(`http://localhost:${SERVER_PORT}/health`)).json()).seatsTaken;
}

/** A tab of the given browser profile, open on the client and seated in the world. */
async function openTab(profile, name) {
  const page = await profile.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  // A dropped socket while the server is down is this run's own doing, not an error of the page.
  page.on('console', (message) => message.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|Failed to fetch/i.test(message.text()) && pageErrors.push(`${name}: ${message.text()}`));
  await page.goto(`http://localhost:${CLIENT_PORT}/`);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 15000 });
  return page;
}

/** Where the tab's own player stands and what the tab shows. Distances come from the map the page runs, not from numbers typed here. */
function stateOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const screen = document.getElementById('screen');
    const status = api?.online?.status();
    const shown = screen && !screen.hidden ? screen.dataset.screen : null;
    if (!api || status?.kind !== 'online') return { status: status?.kind, screen: shown, screenText: screen?.querySelector('p')?.textContent ?? '' };
    const slot = api.localSlot();
    const entities = api.snapshot().entities.filter((entity) => entity.components.Player);
    const own = entities.find((entity) => entity.components.Player.slot === slot);
    const position = own && { x: own.components.Position.x, y: own.components.Position.y };
    const tile = position && api.tileAt(position.x, position.y);
    const tilesFromSpawn = tile && Math.max(Math.abs(tile.column - api.map.spawn.column), Math.abs(tile.row - api.map.spawn.row));
    return { status: status.kind, slot, screen: shown, screenText: '', players: entities.length, position, tile, tilesFromSpawn, tick: api.sim.tick };
  });
}

/** Holds a key for a while, lets go, and returns the state once the player has come to rest. */
async function walk(page, key, holdMs) {
  await page.bringToFront();
  await page.keyboard.down(key);
  await sleep(holdMs);
  await page.keyboard.up(key);
  let last = await stateOf(page);
  return waitFor('the player to come to rest', {
    read: async () => {
      await sleep(400);
      const now = await stateOf(page);
      const resting = samePoint(now.position, last.position);
      last = now;
      return resting ? now : undefined;
    },
    until: Boolean,
  });
}

/** Equal to a tenth of a millimetre: a position goes through 32-bit physics and JSON on its way. */
function samePoint(a, b) {
  return Boolean(a && b) && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
}

function show(point) {
  return point ? `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})` : 'nowhere';
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
