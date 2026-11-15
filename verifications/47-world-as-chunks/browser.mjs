/* global window */
/**
 * What the browser scripts share: opening the game, solo or online, and
 * taking a picture of the whole map with nothing on it but terrain, so two
 * pictures can be compared pixel for pixel.
 */
import path from 'node:path';
import { ROOT, lastLinesOf, start, waitFor, waitForPort } from './lib.mjs';

/** At zoom 1 a 640x480 canvas is exactly the 40x30 tile map at 16 pixels a tile. */
export const WHOLE_MAP_VIEWPORT = { width: 640, height: 480 };
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

/**
 * A PNG of the canvas showing terrain only: entities (sprites and shapes)
 * and the HUD are hidden and the camera is set to `zoom`, so the picture
 * does not depend on who stands where or on what the HUD says.
 */
export async function terrainPicture(page, { zoom = 1 } = {}) {
  await page.evaluate((wantedZoom) => {
    const { game } = window.__novaland;
    const world = game.scene.getScene('world');
    world.cameras.main.setZoom(wantedZoom);
    for (const child of world.children.list) {
      if (child.type !== 'Image' && child.type !== 'TilemapLayer') child.setVisible(false);
    }
    game.scene.getScene('hud').sys.setVisible(false);
  }, zoom);
  // Two frames: one for the scene to follow the player with the new zoom, one to draw it.
  await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))));
  return page.locator('canvas').screenshot();
}
