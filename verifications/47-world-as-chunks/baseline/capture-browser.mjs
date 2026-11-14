/**
 * Run once, on the code before this ticket, next to capture-sim.ts: the
 * "before" screenshots. Solo and online, the whole map with terrain only
 * (compared pixel for pixel with the new code by 04-same-look.mjs) and the
 * game as a player sees it when it opens.
 *
 *   node verifications/47-world-as-chunks/baseline/capture-browser.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PLAY_VIEWPORT, WHOLE_MAP_VIEWPORT, openGame, startClient, startRoomServer, terrainPicture } from '../browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLO_PORT = 5947;
const SERVER_PORT = 5948;
const ONLINE_PORT = 5949;

const servers = [await startClient({ port: SOLO_PORT }), await startRoomServer({ port: SERVER_PORT }), await startClient({ port: ONLINE_PORT, env: { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } })];
const browser = await chromium.launch();
try {
  for (const [name, port, online] of [['solo', SOLO_PORT, false], ['online', ONLINE_PORT, true]]) {
    const play = await openGame(browser, { port, viewport: PLAY_VIEWPORT, online });
    await play.waitForTimeout(500);
    await play.screenshot({ path: path.join(HERE, `before-${name}-play.png`) });
    await play.context().close();
    const whole = await openGame(browser, { port, viewport: WHOLE_MAP_VIEWPORT, online });
    writeFileSync(path.join(HERE, `before-${name}-terrain.png`), await terrainPicture(whole));
    await whole.context().close();
    console.log(`captured ${name}`);
  }
} finally {
  await browser.close();
  for (const server of servers) server.stop();
}
process.exit(0);
