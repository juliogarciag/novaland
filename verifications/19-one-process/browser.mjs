/* global window, document */
/**
 * Shared Playwright helpers for the browser checks: pages that record their
 * console errors, failed responses and the WebSocket frames they receive, and
 * a world observer (observer.ts, run with the server package's tsx) that
 * reports every player's position from a replica of the authoritative world.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './lib.mjs';

export const VIEWPORT = { width: 960, height: 720 };

/** Opens `url` in a fresh context and keeps everything the page says and receives. */
export async function openPlayer(browser, name, url) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const player = { name, context, page, consoleErrors: [], pageErrors: [], failedResponses: [], responses: [], frames: [] };
  page.on('pageerror', (error) => player.pageErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && player.consoleErrors.push(message.text()));
  page.on('response', (response) => {
    const entry = { url: response.url(), status: response.status(), contentType: response.headers()['content-type'] ?? '' };
    player.responses.push(entry);
    if (response.status() >= 400) player.failedResponses.push(entry);
  });
  page.on('requestfailed', (request) => player.failedResponses.push({ url: request.url(), status: 'failed', contentType: request.failure()?.errorText ?? '' }));
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => player.frames.push({ at: Date.now(), bytes: frame.payload.length }));
  });
  await page.goto(url);
  return player;
}

/** The connection screen the page shows, or null when it is hidden (the player is online); plus whether the dev debug API exists. */
export function screenOf(page) {
  return page.evaluate(() => {
    const screen = document.getElementById('screen');
    return {
      screen: screen && !screen.hidden ? screen.dataset.screen : null,
      text: screen ? screen.textContent.trim() : '',
      hasDebugApi: typeof window.__novaland !== 'undefined',
      canvas: document.querySelector('canvas') !== null,
    };
  });
}

/** Resolves once the page hides its connection screen and has a canvas (seated and drawing). */
export async function waitSeated(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const screen = document.getElementById('screen');
    return screen !== null && screen.hidden && document.querySelector('canvas') !== null;
  }, undefined, { timeout: timeoutMs });
  return screenOf(page);
}

/** Starts observer.ts against `endpoint`; `latest` is the newest world sample, `samples` every one so far. */
export function startObserver(endpoint) {
  const child = spawn('pnpm', ['exec', 'tsx', path.join(ROOT, 'verifications/19-one-process/observer.ts'), endpoint], { cwd: path.join(ROOT, 'packages/server'), stdio: ['ignore', 'pipe', 'pipe'] });
  const observer = { child, slot: undefined, latest: undefined, samples: [], output: '', stop: () => child.kill('SIGTERM') };
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      observer.output += `${line}\n`;
      if (!line.startsWith('{')) continue;
      const event = JSON.parse(line);
      if (event.event === 'welcomed') observer.slot = event.slot;
      if (event.event === 'world') {
        observer.latest = event;
        observer.samples.push(event);
      }
    }
  });
  child.stderr.on('data', (chunk) => (observer.output += chunk));
  return observer;
}

/** Polls `read` until `accept` likes it; throws with the last value after `timeoutMs`. */
export async function waitFor(read, accept, what, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
}

/** Players the observer sees other than itself. */
export function othersSeenBy(observer) {
  return observer.latest ? observer.latest.players.filter((player) => player.slot !== observer.slot) : [];
}

/**
 * Holds `key` on `page` for `holdMs` and reports, from the observer, which
 * player moved with the expected intent and how far: the authoritative world's
 * view of that page's input.
 */
export async function walk(page, key, intent, observer, holdMs = 800) {
  const before = othersSeenBy(observer);
  await page.keyboard.down(key);
  const moving = await waitFor(() => othersSeenBy(observer), (players) => players.some((player) => player.intentX === intent.x && player.intentY === intent.y), `a player with intent ${JSON.stringify(intent)}`);
  const mover = moving.find((player) => player.intentX === intent.x && player.intentY === intent.y);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await waitFor(() => othersSeenBy(observer), (players) => players.every((player) => player.intentX === 0 && player.intentY === 0), 'everyone still');
  const start = before.find((player) => player.slot === mover.slot);
  const end = othersSeenBy(observer).find((player) => player.slot === mover.slot);
  return { slot: mover.slot, start, end, distance: start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0 };
}

/** Bytes per received WebSocket frame on `player` between two moments. */
export function framesBetween(player, fromMs, toMs) {
  return player.frames.filter((frame) => frame.at >= fromMs && frame.at <= toMs).map((frame) => frame.bytes);
}

export function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The status of a WebSocket upgrade to `port` carrying `origin` (none when undefined) and `host` (what a browser at `http://localhost:<port>` would send, unless given): 101 when accepted, else what refused it. */
export function upgradeStatus(port, origin, host = `localhost:${port}`) {
  return import('node:http').then(
    ({ default: http }) =>
      new Promise((resolve, reject) => {
        const headers = { host, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
        if (origin !== undefined) headers.origin = origin;
        const request = http.request({ host: '127.0.0.1', port, path: '/world', method: 'GET', headers });
        request.on('upgrade', (response, socket) => {
          socket.destroy();
          resolve(response.statusCode);
        });
        request.on('response', (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.on('error', reject);
        request.end();
      }),
  );
}

/** `GET path` with the raw path (fetch would normalise `..` away): the status code. */
export function rawStatus(port, rawPath) {
  return import('node:http').then(
    ({ default: http }) =>
      new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end();
      }),
  );
}

/** The requests and upgrades that end a Colyseus process with nothing in front of it (its router and its transport throw outside any handler when `X-Forwarded-Proto`, `Host` and the target do not make a URL), each as the lines to write to a socket. */
export function requestsColyseusCannotSurvive(port) {
  const host = `Host: localhost:${port}`;
  const json = ['Content-Type: application/json', 'Content-Length: 2', '', '{}'];
  const upgrade = ['Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='];
  return [
    ['an absolute URL as the target', ['GET http://evil.example/healthz HTTP/1.1', host]],
    ['an absolute URL as the target of a matchmaking call', ['POST http://evil.example/matchmake/joinById/world HTTP/1.1', host, ...json]],
    ['a Host that is no host, on a matchmaking call', ['POST /matchmake/joinById/world HTTP/1.1', 'Host: exa[mple', ...json]],
    ['a Host with a port that is no port', ['POST /matchmake/joinById/world HTTP/1.1', 'Host: a:b', ...json]],
    ['a Host that is no host, on the Colyseus health route', ['GET /__healthcheck HTTP/1.1', 'Host: exa[mple']],
    ['a forwarded protocol that is no protocol', ['POST /matchmake/joinById/world HTTP/1.1', host, 'X-Forwarded-Proto: ht tp', ...json]],
    ['two forwarded protocols', ['POST /matchmake/joinById/world HTTP/1.1', host, 'X-Forwarded-Proto: https, http', ...json]],
    ...['*:99999999', '*%', '*[', '*:abc'].map((target) => [`an upgrade whose target is ${target}`, [`GET ${target} HTTP/1.1`, host, ...upgrade]]),
    ['an upgrade with a Host that is no host', ['GET /world HTTP/1.1', 'Host: a:b', ...upgrade]],
  ];
}

/** Writes the request lines to a bare socket, as no HTTP client would, and returns the status line of the answer (or says there was none). */
export function rawStatusLine(port, lines) {
  return import('node:net').then(
    ({ default: net }) =>
      new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        let received = '';
        const answer = () => received.split('\r\n')[0] || 'no answer';
        socket.setTimeout(3000, () => {
          socket.destroy();
          resolve(answer());
        });
        socket.on('data', (chunk) => {
          received += chunk.toString('latin1');
          if (received.includes('\r\n')) {
            socket.destroy();
            resolve(answer());
          }
        });
        socket.on('error', () => resolve(answer()));
        socket.on('close', () => resolve(answer()));
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      }),
  );
}
