/* global window */
/**
 * V3: latency against a real server connection. The real room server, the
 * real client pointed at it through a TCP proxy that delays every chunk, in
 * Chromium. The HUD shows `latency N ms`; N is small straight through, grows
 * by twice the proxy's delay when there is one, follows when the delay
 * changes, keeps growing while the connection stalls and comes back after;
 * the pings are the room's own one-byte ping, once a second; they do not keep
 * an idle player seated; a dropped connection shows no latency and a new seat
 * measures afresh.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { MIN_CONTRAST, hudNumbers, hudOf, measureHudPixels, startDelayProxy, waitForHud } from './hud.mjs';
import { PROOF, ROOT, check, isPortOpen, start, summarize, waitForPort, writeProof } from './lib.mjs';

const CLIENT_PORT = 5351;
const SERVER_PORT = 5352;
const PROXY_PORT = 5353;
const IDLE_CLIENT_PORT = 5354;
const IDLE_SERVER_PORT = 5355;
const IDLE_TIMEOUT_SECONDS = 6;
const VIEWPORT = { width: 960, height: 720 };
const ONLINE_LINE = /^fps +(\d+|--) {3}latency +(\d+|--) ms {3}1\/5 online$/;
const results = [];
const report = {};
const pageErrors = [];
const serverDir = path.join(ROOT, 'packages/server');
const startServer = (port, env = {}) => start('pnpm', ['dev'], { cwd: serverDir, env: { PORT: String(port), ...env } });

let server = startServer(SERVER_PORT);
const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${PROXY_PORT}` } });
const idleServer = startServer(IDLE_SERVER_PORT, { IDLE_TIMEOUT_SECONDS: String(IDLE_TIMEOUT_SECONDS) });
const idleClient = start('pnpm', ['dev'], { env: { PORT: String(IDLE_CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${IDLE_SERVER_PORT}` } });
let proxy;
let browser;
try {
  proxy = await startDelayProxy({ listenPort: PROXY_PORT, targetPort: SERVER_PORT });
  results.push(check('room server, proxy and client dev server up', (await waitForPort(SERVER_PORT)) && (await waitForPort(PROXY_PORT)) && (await waitForPort(CLIENT_PORT))));
  browser = await chromium.launch();
  const open = async (port) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    // The room's ping is a frame of one byte each way; everything else the game sends is longer.
    const pings = { sent: 0, answered: 0 };
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => payload.length === 1 && (pings.sent += 1));
      socket.on('framereceived', ({ payload }) => payload.length === 1 && (pings.answered += 1));
    });
    await page.goto(`http://localhost:${port}/`);
    return { page, pings };
  };
  /** The HUD's latency next to the connection's own, read in one go. */
  const latencyOf = async (page) => {
    const [hud, connection] = await Promise.all([hudOf(page), page.evaluate(() => window.__novaland.online.latencyMs())]);
    return { hud: hudNumbers(hud).latency, connection, line: hud.lines[0] };
  };
  /** Samples the HUD latency every 100 ms for `milliseconds`. */
  const sampleLatency = async (page, milliseconds) => {
    const samples = [];
    const until = Date.now() + milliseconds;
    while (Date.now() < until) {
      samples.push((await latencyOf(page)).hud);
      await page.waitForTimeout(100);
    }
    return samples;
  };
  const waitForLatency = async (page, accept, label, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await latencyOf(page);
      if (last.hud !== undefined && accept(last.hud)) return last;
      await page.waitForTimeout(100);
    }
    throw new Error(`latency never ${label}: ${JSON.stringify(last)}`);
  };

  // 1. Straight through: a small number, on the HUD's first line with the seats.
  const { page, pings } = await open(CLIENT_PORT);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online', undefined, { timeout: 30000 });
  const joined = await waitForHud(page, ONLINE_LINE);
  results.push(check('online the first line reads fps, latency and the seats taken', ONLINE_LINE.test(joined.lines[0]), joined.lines[0]));
  const direct = await waitForLatency(page, (latency) => latency < 40, 'settled under 40 ms');
  results.push(check('with no delay the round trip to the local server is a few milliseconds', direct.hud < 40, `${direct.hud} ms`));
  results.push(check('the HUD shows the connection\'s own measurement', direct.connection !== undefined && Math.abs(direct.hud - direct.connection) <= 1, `HUD ${direct.hud}, connection ${direct.connection}`));
  const text = joined.lines.join(' | ');
  results.push(check('online too, the tick counter and the movement help are gone', !/tick|WASD|arrows/i.test(text), text));
  results.push(check('who you are and the player count are kept; no J hint online', /^you: \S+ {3}players: 1$/.test(joined.lines[1]) && joined.lines.length === 2, joined.lines[1]));

  // 2. The pings are the room's own, once a second.
  const before = { ...pings };
  await page.waitForTimeout(5000);
  const sentInFiveSeconds = pings.sent - before.sent;
  const answeredInFiveSeconds = pings.answered - before.answered;
  results.push(check('the client sends the room\'s one-byte ping once a second and the server answers each', sentInFiveSeconds >= 4 && sentInFiveSeconds <= 6 && Math.abs(answeredInFiveSeconds - sentInFiveSeconds) <= 1, `${sentInFiveSeconds} sent, ${answeredInFiveSeconds} answered in 5 s`));

  // 3. A real delay shows up: 60 ms each way is 120 ms more, 150 ms each way is 300 ms more.
  proxy.setDelay(60);
  const delayed = await waitForLatency(page, (latency) => latency >= 120, 'reached 120 ms');
  await page.waitForTimeout(2200);
  const delayedSamples = await sampleLatency(page, 2500);
  results.push(check('with 60 ms added each way the HUD shows a round trip of 120 ms or a little more', delayedSamples.every((latency) => latency >= 120 && latency <= 220), `${Math.min(...delayedSamples)}..${Math.max(...delayedSamples)} ms`));
  await page.screenshot({ path: path.join(PROOF, '03-latency-120ms.png') });
  proxy.setDelay(150);
  await waitForLatency(page, (latency) => latency >= 300, 'reached 300 ms');
  await page.waitForTimeout(2200);
  const slowerSamples = await sampleLatency(page, 2500);
  results.push(check('with 150 ms each way it follows to 300 ms or a little more', slowerSamples.every((latency) => latency >= 300 && latency <= 420), `${Math.min(...slowerSamples)}..${Math.max(...slowerSamples)} ms`));
  const hudAt300 = await hudOf(page);
  const shot300 = await page.screenshot({ path: path.join(PROOF, '03-latency-300ms.png') });
  const pixels = measureHudPixels(shot300, hudAt300);
  results.push(check(`the online HUD, wider than the solo one, is on its backdrop too: contrast >= ${MIN_CONTRAST}`, pixels.contrast >= MIN_CONTRAST && pixels.textPixels > 200, `${pixels.contrast}:1, box ${Math.round(hudAt300.box.width)}x${Math.round(hudAt300.box.height)}`));

  // 4. A stall: nothing gets through for a while. The number keeps growing instead of showing the last good one.
  proxy.setDelay(0);
  await waitForLatency(page, (latency) => latency < 60, 'came back under 60 ms');
  proxy.hold();
  await page.waitForTimeout(2000);
  const stalledEarly = await latencyOf(page);
  await page.waitForTimeout(1500);
  const stalledLate = await latencyOf(page);
  await page.screenshot({ path: path.join(PROOF, '03-latency-stalled.png') });
  results.push(check('while the connection is stalled the latency shown grows with the wait', stalledEarly.hud >= 900 && stalledLate.hud >= stalledEarly.hud + 1000, `${stalledEarly.hud} ms, then ${stalledLate.hud} ms 1.5 s later`));
  proxy.release();
  const afterStall = await waitForLatency(page, (latency) => latency < 60, 'recovered under 60 ms', 10000);
  const stillOnline = await page.evaluate(() => window.__novaland.online.status().kind);
  results.push(check('when traffic flows again the latency is small again and the player is still seated', afterStall.hud < 60 && stillOnline === 'online', `${afterStall.hud} ms, ${stillOnline}`));
  report.latency = { direct, delayed, delayedSamples, slowerSamples, stalledEarly, stalledLate, afterStall, pings: { sentInFiveSeconds, answeredInFiveSeconds } };

  // 5. No server, no latency; a new seat measures afresh.
  server.stop();
  await page.waitForSelector('#screen[data-screen="disconnected"]', { timeout: 15000 });
  const whileDown = await page.evaluate(() => window.__novaland.online.latencyMs());
  results.push(check('with the server gone the connection reports no latency', whileDown === undefined, String(whileDown)));
  for (let waited = 0; waited < 50 && (await isPortOpen(SERVER_PORT)); waited += 1) await page.waitForTimeout(100);
  server = startServer(SERVER_PORT);
  await waitForPort(SERVER_PORT);
  await page.waitForFunction(() => window.__novaland.online.status().kind === 'online', undefined, { timeout: 30000 });
  const back = await waitForLatency(page, (latency) => latency < 60, 'was measured again');
  results.push(check('seated again after the restart, the latency is measured again', back.hud < 60 && back.connection !== undefined, `${back.hud} ms`));
  report.reconnect = { whileDown: whileDown ?? null, back };

  // 6. Pings are not input: a player who only pings is still freed as idle.
  results.push(check(`a second room server with a ${IDLE_TIMEOUT_SECONDS} s idle timeout and its client are up`, (await waitForPort(IDLE_SERVER_PORT)) && (await waitForPort(IDLE_CLIENT_PORT))));
  const idle = await open(IDLE_CLIENT_PORT);
  await idle.page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online', undefined, { timeout: 30000 });
  const seatedAt = Date.now();
  await idle.page.waitForSelector('#screen[data-screen="away"]', { timeout: (IDLE_TIMEOUT_SECONDS + 10) * 1000 });
  const kickedAfterSeconds = (Date.now() - seatedAt) / 1000;
  results.push(check('a seated player who sends pings but no input is still freed after the idle timeout', idle.pings.answered >= IDLE_TIMEOUT_SECONDS - 2 && kickedAfterSeconds >= IDLE_TIMEOUT_SECONDS - 1 && kickedAfterSeconds <= IDLE_TIMEOUT_SECONDS + 5, `${idle.pings.answered} pings answered, away after ${kickedAfterSeconds.toFixed(1)} s`));
  const awayLatency = await idle.page.evaluate(() => window.__novaland.online.latencyMs());
  const pingsWhenAway = idle.pings.sent;
  await idle.page.waitForTimeout(2500);
  results.push(check('once away there is no latency and no more pings', awayLatency === undefined && idle.pings.sent === pingsWhenAway, `latency ${String(awayLatency)}, ${idle.pings.sent - pingsWhenAway} pings in 2.5 s`));
  report.idle = { pingsAnswered: idle.pings.answered, kickedAfterSeconds };
  results.push(check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; ')));
} catch (error) {
  results.push(check('the script ran to the end', false, String(error?.stack ?? error)));
} finally {
  await browser?.close();
  await proxy?.stop();
  for (const process of [client, server, idleClient, idleServer]) process.stop();
}
writeProof('03-latency.json', report);
process.exit(summarize(results) ? 0 : 1);
