/* global window, document */
/**
 * #64 online: the 32-pixel world against the real room server.
 *
 * Starts the room server and a client pointed at it and opens two players,
 * each in a browser context of its own. Both join the same world, and each
 * tab draws it at 32 pixels per metre at the zoom the solo check expects,
 * with both characters on the 16x24 sheet scaled 2x and every name sitting
 * just above its character's head. Screenshots keep both tabs.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5265;
const CLIENT_PORT = 5266;
const VIEWPORT = { width: 1280, height: 800 };
/** What the world's art was drawn at before this ticket: the scale the camera has to keep. */
const PIXELS_PER_METRE_BEFORE = 16;
/** The player's sheet stood 1 x 1.5 m at 16 pixels per metre (16x24 frames). */
const PLAYER_METRES_BEFORE = { width: 1, height: 1.5 };
const NAME_GAP_METRES_BEFORE = 1 / 16;
const results = [];
const report = {};
const pageErrors = [];

const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT) } });
const devServer = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let browser;
try {
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  const bootLine = portsUp && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean }).catch(() => undefined));
  const clientReady = portsUp && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  const ready = Boolean(bootLine) && clientReady;
  results.push(check('room server and dev server up, both started by this run', ready, ready ? bootLine : `${lastLinesOf(roomServer.output)} | ${lastLinesOf(devServer.output)}`));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const tabA = await openTab('Ana', { skin: 1, hair: 2, clothes: 3 });
  const tabB = await openTab('Bo', { skin: 4, hair: 0, clothes: 5 });
  const together = await waitFor('both tabs draw two names', {
    read: async () => ({ A: await whatTheTabDraws(tabA), B: await whatTheTabDraws(tabB) }),
    until: ({ A, B }) => A.names.length === 2 && B.names.length === 2,
  }).catch(() => undefined);
  results.push(check('both players are seated and each tab draws both of them', together !== undefined, together && `A sees ${together.A.names.map((name) => name.name)}, B sees ${together.B.names.map((name) => name.name)}`));

  for (const [tabName, seen] of Object.entries(together ?? {})) {
    const { camera, pixelsPerMetre, minVisibleMetres, names, players, terrain } = seen;
    const zoomBefore = Math.max(1, Math.floor(camera.width / (PIXELS_PER_METRE_BEFORE * minVisibleMetres)));
    results.push(
      check(
        `tab ${tabName}: the world at 32 px per metre, a metre as many device pixels as before`,
        pixelsPerMetre === 32 && camera.zoom * pixelsPerMetre === zoomBefore * PIXELS_PER_METRE_BEFORE && terrain.standingImages > 0,
        `zoom ${camera.zoom} (${zoomBefore} before), ${camera.visibleMetres.width} m across, ${terrain.chunksDrawn.length} chunks and ${terrain.standingImages} trees and rocks drawn`,
      ),
    );
    const playersAsBefore = players.length === 2 && players.every((player) => close(player.width, PLAYER_METRES_BEFORE.width) && close(player.height, PLAYER_METRES_BEFORE.height));
    results.push(check(`tab ${tabName}: both characters stand ${PLAYER_METRES_BEFORE.width} x ${PLAYER_METRES_BEFORE.height} m`, playersAsBefore, players.map((player) => `${player.width} x ${player.height} m at ${player.scale}x`).join(', ')));
    const namesAbove = names.every((name) => name.overHead && close(name.gapMetres, NAME_GAP_METRES_BEFORE));
    results.push(check(`tab ${tabName}: every name sits ${NAME_GAP_METRES_BEFORE} m above its own character's head`, namesAbove, names.map((name) => `${name.name}: gap ${name.gapMetres} m`).join(', ')));
  }

  // Bring B next to A, so a screenshot shows both characters and both names.
  await walkTowards(tabB, tabA);
  await tabA.screenshot({ path: path.join(PROOF, 'online-A.png') });
  await tabB.screenshot({ path: path.join(PROOF, 'online-B.png') });
  report.together = together;
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
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

async function openTab(name, look) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, { name, look });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${name}: ${message.text()}`));
  await page.goto(`http://localhost:${CLIENT_PORT}/`);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0 && !document.getElementById('screen')?.checkVisibility?.(), null, { timeout: 20000 });
  return page;
}

/** The camera, the drawn characters in metres, and where every name sits against its own character's head. */
function whatTheTabDraws(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const ppm = api.pixelsPerMetre;
    const scene = api.game.scene.getScene('world');
    const names = api.drawnNames();
    const keys = new Set(names.map((name) => name.textureKey));
    const sprites = scene.children.list.filter((object) => object.type === 'Sprite' && keys.has(object.texture.key));
    return {
      pixelsPerMetre: ppm,
      minVisibleMetres: api.minVisibleMetres,
      camera: api.camera(),
      terrain: api.terrain(),
      players: sprites.map((sprite) => ({ width: sprite.displayWidth / ppm, height: sprite.displayHeight / ppm, scale: sprite.scaleX })),
      names: names.map((name) => {
        const sprite = sprites.find((candidate) => Math.abs(candidate.x - name.x) < 1e-6 && candidate.texture.key === name.textureKey);
        const headY = sprite ? sprite.y - sprite.displayHeight * sprite.originY : Number.NaN;
        return { name: name.name, overHead: sprite !== undefined, gapMetres: (headY - name.y) / ppm };
      }),
    };
  });
}

/** Walks B a few steps towards A along whichever axis is longer, so both stand on A's screen. */
async function walkTowards(walker, other) {
  const positionOf = (page) => page.evaluate(() => window.__novaland.online.localPlayerDrawnAt());
  const [from, to] = [await positionOf(walker), await positionOf(other)];
  if (!from || !to) return;
  const across = to.x - from.x;
  const down = to.y - from.y;
  const key = Math.abs(across) >= Math.abs(down) ? (across > 0 ? 'KeyD' : 'KeyA') : down > 0 ? 'KeyS' : 'KeyW';
  if (Math.hypot(across, down) < 3) return;
  await walker.keyboard.down(key);
  await walker.waitForTimeout(400);
  await walker.keyboard.up(key);
  await walker.waitForTimeout(500);
}

function close(value, expected) {
  return Math.abs(value - expected) < 1e-6;
}
