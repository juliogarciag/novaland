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

/** The status of a WebSocket upgrade to `port` on 127.0.0.1 carrying `origin` (none when undefined): 101 when accepted, else what refused it. */
export function upgradeStatus(port, origin) {
  return import('node:http').then(
    ({ default: http }) =>
      new Promise((resolve, reject) => {
        const headers = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
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
