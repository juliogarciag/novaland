/* global window */
/**
 * What the browser scripts share: starting the servers and opening the
 * game, solo or online.
 */
import path from 'node:path';
import { ROOT, lastLinesOf, start, waitFor, waitForPort } from './lib.mjs';

export const PLAY_VIEWPORT = { width: 960, height: 720 };

/** Starts `PORT=<n> pnpm dev` and waits for its ready line. Throws with the server's last lines when it does not come up. */
export async function startClient({ port, env = {} }) {
  const devServer = start('pnpm', ['dev'], { env: { PORT: String(port), ...env } });
  const ready = (await waitForPort(port)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${port}/`), until: Boolean, timeoutMs: 20000 }).catch(() => false));
  if (!ready) throw new Error(`the dev server did not start: ${lastLinesOf(devServer.output)}`);
  return devServer;
}

/** Starts the room server and waits for its boot line. */
export async function startRoomServer({ port, env = {} }) {
  const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(port), ...env } });
  const bootLine = (await waitForPort(port)) && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean, timeoutMs: 20000 }).catch(() => undefined));
  if (!bootLine) throw new Error(`the room server did not start: ${lastLinesOf(roomServer.output)}`);
  return roomServer;
}

/** A page of its own browser context, open on the game and playing: the sim has ticked (solo) or the seat is taken (online). */
export async function openGame(browser, { port, viewport, online = false, errors = [] }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`http://localhost:${port}/`);
  if (online) await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 20000 });
  else await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__novaland.game.scene.isActive('world') && window.__novaland.camera() !== undefined, null, { timeout: 20000 });
  return page;
}
