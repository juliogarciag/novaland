/* global window, document */
/**
 * V3: the idle kick in the real client, in Chromium, against the real room
 * server booted with a short idle timeout. A tab that sends no input is kicked
 * at the timeout and stays out: it shows the away screen with a Rejoin button
 * and sends no join by itself. Its seat is free: a second tab gets that very
 * seat and the world counts one player. Pressing Enter on the away screen,
 * even after the Rejoin button lost focus, rejoins on purpose into the next
 * free seat, and both tabs see two players. B holds one direction the whole
 * time (one move, then nothing, as the client sends it) and is never kicked
 * while it walks; the rejoined A, idle again, is kicked again from its new
 * seat; B's tab is then hidden with the key still down, the client sends a
 * stop by itself, and B is kicked a timeout later.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const IDLE_TIMEOUT_SECONDS = 4;
const SERVER_PORT = 5422;
const CLIENT_PORT = 5423;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = { idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS, steps: [] };
const pageErrors = [];
const serverDir = path.join(ROOT, 'packages/server');

const server = start('pnpm', ['dev'], { cwd: serverDir, env: { PORT: String(SERVER_PORT), IDLE_TIMEOUT_SECONDS: String(IDLE_TIMEOUT_SECONDS) } });
const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let browser;
try {
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  // The port opens a moment before the boot line is printed. Both lines also prove the ports are ours, not something already listening there.
  const bootLine = portsUp && (await waitFor(async () => server.output.split('\n').find((line) => line.includes('world-room-listening')), Boolean, 'the server boot line', 10000).catch(() => undefined));
  const clientReady = portsUp && (await waitFor(async () => client.output.includes(`localhost:${CLIENT_PORT}/`), Boolean, "the client's ready line", 10000).catch(() => false));
  results.push(check(`room server up with a ${IDLE_TIMEOUT_SECONDS} s idle timeout, client dev server up, both started by this run`, Boolean(bootLine) && bootLine.includes(`"idleTimeoutSeconds":${IDLE_TIMEOUT_SECONDS}`) && clientReady, bootLine));
  browser = await chromium.launch();
  const open = async (name) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
    // Every join starts with the SDK's matchmake request; counting them shows whether the page tries again by itself.
    const joins = { count: 0 };
    page.on('request', (request) => request.url().includes('/matchmake/joinById/') && (joins.count += 1));
    await page.goto(`http://localhost:${CLIENT_PORT}/`);
    return { name, context, page, joins };
  };

  // 1. A joins and then sends nothing.
  const a = await open('A');
  await waitOnline(a.page);
  const aJoinedAt = Date.now();
  const aSeated = await stateOf(a.page);
  await a.page.screenshot({ path: path.join(PROOF, '03-browser-1-A-online.png') });
  results.push(check('A joins the world and is seated', aSeated.status.kind === 'online' && aSeated.screen === null, JSON.stringify(aSeated.status)));

  // 2. At the timeout the server frees A's seat; A shows the away screen and does not come back by itself.
  await a.page.waitForSelector('#screen[data-screen="away"]', { timeout: (IDLE_TIMEOUT_SECONDS + 5) * 1000 });
  const kickedAfterSeconds = (Date.now() - aJoinedAt) / 1000;
  const away = await screenOf(a.page);
  const joinsAtKick = a.joins.count;
  await a.page.screenshot({ path: path.join(PROOF, '03-browser-2-A-away.png') });
  results.push(check(`A is kicked at the idle timeout (${IDLE_TIMEOUT_SECONDS} s, at most 1.5 s late)`, kickedAfterSeconds >= IDLE_TIMEOUT_SECONDS - 0.3 && kickedAfterSeconds <= IDLE_TIMEOUT_SECONDS + 1.5, `${kickedAfterSeconds.toFixed(2)} s`));
  results.push(check('A shows the away screen: "you were away" and a focused Rejoin button', away.status.kind === 'away' && /You were away/.test(away.text) && away.buttonText === 'Rejoin' && away.buttonVisible && away.buttonFocused, JSON.stringify(away)));
  // A reconnecting client would have come back after its first 1 s wait; 9 s is several of those.
  await a.page.waitForTimeout(9000);
  const stillAway = await screenOf(a.page);
  results.push(check('A stays away: no join sent by itself in 9 s, the away screen still up', a.joins.count === joinsAtKick && stillAway.status.kind === 'away' && stillAway.screen === 'away', `joins ${joinsAtKick} -> ${a.joins.count}, ${JSON.stringify(stillAway.status)}`));
  report.steps.push({ step: 'kicked', aSeated: aSeated.status, kickedAfterSeconds, away, stillAway, joinsAtKick, joinsAfterWait: a.joins.count });

  // 3. A's seat is free: B gets that very seat and sees only itself.
  const b = await open('B');
  await waitOnline(b.page);
  const bAlone = await waitFor(() => stateOf(b.page), (state) => /online/.test(state.hud) && state.players.length === 1, 'B seated and alone');
  // B walks east and holds the key: the client sends one move and then nothing while the key stays down. Pressed once the game is drawn, so its keyboard sees it; the server's echo shows the move arrived.
  // Each context is its own headless window: bring B's to the front and click its canvas so the key reaches the game, and press again once if the first press was lost.
  await b.page.bringToFront();
  await b.page.click('canvas');
  await b.page.keyboard.down('KeyD');
  const walkArrived = (timeoutMs) => waitFor(() => stateOf(b.page), (state) => state.ownIntent?.x === 1, "B's walk east reached the server", timeoutMs);
  const bWalking = await walkArrived(1000).catch(async () => {
    await b.page.keyboard.up('KeyD');
    await b.page.keyboard.down('KeyD');
    return walkArrived(1500);
  });
  report.steps.push({ step: 'B-walking', intent: bWalking.ownIntent });
  await b.page.screenshot({ path: path.join(PROOF, '03-browser-3-B-in-A-seat.png') });
  results.push(check("B takes A's freed seat and the world holds one player: B", bAlone.status.slot === aSeated.status.slot && bAlone.players.length === 1 && /1\/5 online/.test(bAlone.hud), `A had seat ${aSeated.status.slot}, B got ${bAlone.status.slot}; ${bAlone.hud.split('\n').find((line) => /online/.test(line))}`));

  // 4. A rejoins on purpose with Enter, into the next free seat; both see two players. A click on the message first takes focus off the Rejoin button.
  await a.page.click('#screen p');
  const focusMoved = await a.page.evaluate(() => document.activeElement !== document.querySelector('#screen button:not([hidden])'));
  await a.page.keyboard.press('Enter');
  await waitOnline(a.page);
  const aBack = await waitFor(() => stateOf(a.page), (state) => state.players.length === 2 && /2\/5 online/.test(state.hud), 'A back with two players');
  const bTwo = await waitFor(() => stateOf(b.page), (state) => state.players.length === 2 && /2\/5 online/.test(state.hud), 'B sees A again and counts two');
  await a.page.screenshot({ path: path.join(PROOF, '03-browser-4-A-rejoined.png') });
  results.push(check('Enter on the away screen rejoins A, even with the Rejoin button no longer focused, into a new seat, with one join sent', focusMoved && aBack.status.kind === 'online' && aBack.status.slot !== bAlone.status.slot && aBack.screen === null && a.joins.count === joinsAtKick + 1, `seat ${aBack.status.slot}, joins ${a.joins.count}`));
  results.push(check('both tabs see two players and read 2/5 online', aBack.players.length === 2 && bTwo.players.length === 2 && /2\/5 online/.test(bTwo.hud)));
  const kicksBeforeB = kicksOf(server.output).length;

  // 5. B, holding the same key all along, outlives the timeout twice over and is never kicked: walking is not idle.
  const bWalkedSeconds = await waitForSeconds(b.page, IDLE_TIMEOUT_SECONDS * 2);
  const bAfter = await stateOf(b.page);
  results.push(check(`B, holding one direction since it was seated, is still seated after ${bWalkedSeconds.toFixed(1)} s more (past twice the timeout) and still walking`, bAfter.status.kind === 'online' && bAfter.status.slot === bAlone.status.slot && bWalkedSeconds > IDLE_TIMEOUT_SECONDS * 2 && bAfter.ownIntent?.x === 1, JSON.stringify({ status: bAfter.status, intent: bAfter.ownIntent })));
  // A sat idle again after rejoining, so the server frees its new seat too, and A waits for the player again.
  const aAgain = await screenOf(a.page);
  results.push(check('A, idle again after rejoining, is kicked again from its new seat and shows the away screen again', aAgain.status.kind === 'away' && aAgain.screen === 'away', JSON.stringify(aAgain.status)));
  const kicks = kicksOf(server.output);
  const kicksOfB = kicks.slice(kicksBeforeB).filter((kick) => kick.slot === bAlone.status.slot);
  results.push(check("while B walked the server kicked only A's seats (first A's seat before B took it, then A's new one), never B's", kicksBeforeB === 1 && kicks[0].slot === aSeated.status.slot && kicksOfB.length === 0 && kicks.slice(1).every((kick) => kick.slot === aBack.status.slot), JSON.stringify(kicks)));

  // 6. The player leaves B's tab with D still held: the tab is hidden and loses focus. Headless Chromium never hides a page (a background tab stays visible and keeps its frames), so the page gets what a hidden tab gets: no more animation frames, which stops the game loop and with it the keyboard's own stop, then the hidden state and the events of a tab switch. The client must send the stop itself; a timeout later the seat is freed.
  await b.page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await b.page.waitForTimeout(200); // the frame already scheduled runs, then the loop has nothing to run on
  const hiddenAt = Date.now();
  await b.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  // B's replica still follows the server while hidden (updates arrive as messages, not on the paused loop); A is away again by now, so its replica is stale.
  const bStopped = await waitFor(() => stateOf(b.page), (state) => state.ownIntent?.x === 0, 'the server has B standing still once B is hidden', 2000).catch(() => undefined);
  results.push(check('hiding B with D still held stops B: the server has its avatar standing still within 2 s', bStopped !== undefined, bStopped && JSON.stringify(bStopped.ownIntent)));
  await b.page.waitForSelector('#screen[data-screen="away"]', { timeout: (IDLE_TIMEOUT_SECONDS + 5) * 1000 });
  const bAwayAfterSeconds = (Date.now() - hiddenAt) / 1000;
  await b.page.screenshot({ path: path.join(PROOF, '03-browser-5-B-away-after-its-tab-was-hidden.png') });
  results.push(check(`B, hidden with D held, is kicked a timeout later (${IDLE_TIMEOUT_SECONDS} s, at most 1.5 s late)`, bAwayAfterSeconds >= IDLE_TIMEOUT_SECONDS - 0.3 && bAwayAfterSeconds <= IDLE_TIMEOUT_SECONDS + 1.5, `${bAwayAfterSeconds.toFixed(2)} s`));
  results.push(check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | ')));
  report.steps.push({ step: 'freed-and-rejoined', bAlone: bAlone.status, aBack: aBack.status, bAfter: bAfter.status, bWalkedSeconds, aAgain: aAgain.status, kicks, bAwayAfterSeconds });
} catch (error) {
  results.push(check(`browser run completed (${error.message})`, false));
} finally {
  await browser?.close();
  server.stop();
  client.stop();
}

report.results = results;
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The server's idle-kick log lines, in order. */
function kicksOf(output) {
  return output.split('\n').filter((line) => line.includes('world-room-idle-kick')).map((line) => JSON.parse(line.slice(line.indexOf('{'))));
}

async function waitOnline(page, timeout = 15000) {
  await page.waitForFunction(() => window.__novaland && window.__novaland.online && window.__novaland.online.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout });
}

/** The connection screen of a page as the player sees it, and the status behind it. */
function screenOf(page) {
  return page.evaluate(() => {
    const screen = document.getElementById('screen');
    const shown = screen && !screen.hidden;
    const button = screen ? [...screen.querySelectorAll('button')].find((candidate) => !candidate.hidden) : undefined;
    return {
      status: window.__novaland.online.status(),
      screen: shown ? screen.dataset.screen : null,
      text: shown ? screen.querySelector('p').textContent : null,
      buttonText: button ? button.textContent : null,
      buttonVisible: Boolean(shown && button),
      buttonFocused: Boolean(button && document.activeElement === button),
    };
  });
}

/** Status, players in the replica and HUD of a seated page. */
function stateOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const screen = document.getElementById('screen');
    const players = api.snapshot().entities.filter((entity) => entity.components.Player).map((entity) => ({ slot: entity.components.Player.slot, intent: entity.components.MoveIntent }));
    // The game is built once seated, so for a frame or two the HUD scene may not exist yet: read it as empty, and the wait tries again.
    const hud = api.game?.scene.getScene('hud')?.children.list[0];
    const status = api.online.status();
    const own = players.find((player) => status.kind === 'online' && player.slot === status.slot);
    return { status, players, ownIntent: own?.intent, hud: hud ? hud.text : '', screen: screen && !screen.hidden ? screen.dataset.screen : null };
  });
}

/** Waits `seconds` of real time on a page and returns how long the page has been seated in total, by its own clock. */
async function waitForSeconds(page, seconds) {
  const startedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(seconds * 1000 + 500);
  return ((await page.evaluate(() => performance.now())) - startedAt) / 1000;
}

async function waitFor(read, condition, what, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (condition(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${what} (last: ${JSON.stringify(last).slice(0, 200)})`);
}
