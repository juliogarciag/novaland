/* global window, document */
/**
 * V3: the idle kick in the real client, in Chromium, against the real room
 * server booted with a short idle timeout. A tab that sends no input is kicked
 * at the timeout and stays out: it shows the away screen with a Rejoin button
 * and sends no join by itself. Its seat is free: a second tab gets that very
 * seat and the world counts one player. Pressing Enter on the away screen
 * rejoins on purpose, into the next free seat, and both tabs see two players.
 * A tab that keeps playing is never kicked meanwhile, and the rejoined tab,
 * idle again, is kicked again from its new seat.
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
let keepPlaying;
try {
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  // The port opens a moment before the boot line is printed.
  const bootLine = portsUp && (await waitFor(async () => server.output.split('\n').find((line) => line.includes('world-room-listening')), Boolean, 'the server boot line', 10000).catch(() => undefined));
  results.push(check(`room server up with a ${IDLE_TIMEOUT_SECONDS} s idle timeout, client dev server up`, Boolean(bootLine) && bootLine.includes(`"idleTimeoutSeconds":${IDLE_TIMEOUT_SECONDS}`), bootLine));
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
  // Twice the client's longest reconnect wait would have brought a reconnecting client back several times over.
  await a.page.waitForTimeout(9000);
  const stillAway = await screenOf(a.page);
  results.push(check('A stays away: no join sent by itself in 9 s, the away screen still up', a.joins.count === joinsAtKick && stillAway.status.kind === 'away' && stillAway.screen === 'away', `joins ${joinsAtKick} -> ${a.joins.count}, ${JSON.stringify(stillAway.status)}`));
  report.steps.push({ step: 'kicked', aSeated: aSeated.status, kickedAfterSeconds, away, stillAway, joinsAtKick, joinsAfterWait: a.joins.count });

  // 3. A's seat is free: B gets that very seat and sees only itself.
  const b = await open('B');
  await waitOnline(b.page);
  // B keeps playing (a move on every change of direction) so it is never the idle one.
  let direction = 'KeyD';
  await b.page.keyboard.down(direction);
  keepPlaying = setInterval(() => {
    const next = direction === 'KeyD' ? 'KeyA' : 'KeyD';
    void b.page.keyboard.up(direction).then(() => b.page.keyboard.down(next));
    direction = next;
  }, 1000);
  const bAlone = await waitFor(() => stateOf(b.page), (state) => /online/.test(state.hud) && state.players.length === 1, 'B seated and alone');
  await b.page.screenshot({ path: path.join(PROOF, '03-browser-3-B-in-A-seat.png') });
  results.push(check("B takes A's freed seat and the world holds one player: B", bAlone.status.slot === aSeated.status.slot && bAlone.players.length === 1 && /1\/5 online/.test(bAlone.hud), `A had seat ${aSeated.status.slot}, B got ${bAlone.status.slot}; ${bAlone.hud.split('\n').find((line) => /online/.test(line))}`));

  // 4. A rejoins on purpose with Enter, into the next free seat; both see two players.
  await a.page.keyboard.press('Enter');
  await waitOnline(a.page);
  const aBack = await waitFor(() => stateOf(a.page), (state) => state.players.length === 2 && /2\/5 online/.test(state.hud), 'A back with two players');
  const bTwo = await waitFor(() => stateOf(b.page), (state) => state.players.length === 2 && /2\/5 online/.test(state.hud), 'B sees A again and counts two');
  await a.page.screenshot({ path: path.join(PROOF, '03-browser-4-A-rejoined.png') });
  results.push(check('Enter on the away screen rejoins A, into a new seat, with one join sent', aBack.status.kind === 'online' && aBack.status.slot !== bAlone.status.slot && aBack.screen === null && a.joins.count === joinsAtKick + 1, `seat ${aBack.status.slot}, joins ${a.joins.count}`));
  results.push(check('both tabs see two players and read 2/5 online', aBack.players.length === 2 && bTwo.players.length === 2 && /2\/5 online/.test(bTwo.hud)));
  const kicksBeforeB = kicksOf(server.output).length;

  // 5. B, which kept playing, outlived the timeout several times over and was never kicked.
  const bPlayedSeconds = await waitForSeconds(b.page, IDLE_TIMEOUT_SECONDS * 2);
  const bAfter = await stateOf(b.page);
  results.push(check(`B, which kept playing, is still seated after ${bPlayedSeconds.toFixed(1)} s (more than twice the timeout) and was never kicked`, bAfter.status.kind === 'online' && bAfter.status.slot === bAlone.status.slot && bPlayedSeconds > IDLE_TIMEOUT_SECONDS * 2, JSON.stringify(bAfter.status)));
  // A sat idle again after rejoining, so the server frees its new seat too, and A waits for the player again.
  const aAgain = await screenOf(a.page);
  results.push(check('A, idle again after rejoining, is kicked again from its new seat and shows the away screen again', aAgain.status.kind === 'away' && aAgain.screen === 'away', JSON.stringify(aAgain.status)));
  const kicks = kicksOf(server.output);
  const kicksOfB = kicks.slice(kicksBeforeB).filter((kick) => kick.slot === bAlone.status.slot);
  results.push(check("the server kicked only A's seats (first A's seat before B took it, then A's new one) and never B's", kicksBeforeB === 1 && kicks[0].slot === aSeated.status.slot && kicksOfB.length === 0 && kicks.slice(1).every((kick) => kick.slot === aBack.status.slot), JSON.stringify(kicks)));
  results.push(check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | ')));
  report.steps.push({ step: 'freed-and-rejoined', bAlone: bAlone.status, aBack: aBack.status, bAfter: bAfter.status, bPlayedSeconds, aAgain: aAgain.status, kicks });
} catch (error) {
  results.push(check(`browser run completed (${error.message})`, false));
} finally {
  if (keepPlaying) clearInterval(keepPlaying);
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
    const players = api.snapshot().entities.filter((entity) => entity.components.Player).map((entity) => ({ slot: entity.components.Player.slot }));
    // The game is built once seated, so for a frame or two the HUD scene may not exist yet: read it as empty, and the wait tries again.
    const hud = api.game?.scene.getScene('hud')?.children.list[0];
    return { status: api.online.status(), players, hud: hud ? hud.text : '', screen: screen && !screen.hidden ? screen.dataset.screen : null };
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
