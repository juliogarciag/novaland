/**
 * V4: online, two browsers joined to the real room server.
 *
 * - Each sees itself in the middle of its minimap, the other as a dot in
 *   the colour of the other's clothes where the other is, and the starting point.
 * - The minimap is centred on the position the player sees: the one the
 *   last frame drew the local player at (predicted, ADR 0012), not the
 *   replica's.
 * - When one walks, its dot moves on the other's minimap, by as many
 *   pixels as the tiles it walked.
 */
import { chromium } from 'playwright';
import { clothesColorOf, hex, hold, openGame, pictureOf, saveProofPictures, standStill, startClient, startRoomServer, stateOf } from './browser.mjs';
import { check, summarize, waitFor, writeProof } from './lib.mjs';

const SERVER_PORT = 5964;
const CLIENT_PORT = 5965;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = {};
const errors = [];
const servers = [];
let browser;
try {
  servers.push(await startRoomServer({ port: SERVER_PORT }));
  servers.push(await startClient({ port: CLIENT_PORT, env: { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } }));
  browser = await chromium.launch();
  const tabA = await openGame(browser, { port: CLIENT_PORT, viewport: VIEWPORT, online: true, errors, name: 'A: ', character: { name: 'Ada', look: { skin: 0, hair: 1, clothes: 1 } } });
  const tabB = await openGame(browser, { port: CLIENT_PORT, viewport: VIEWPORT, online: true, errors, name: 'B: ', character: { name: 'Bo', look: { skin: 3, hair: 4, clothes: 3 } } });
  await waitFor('each tab to mark the other', { read: async () => [(await stateOf(tabA)).minimap.marks.length, (await stateOf(tabB)).minimap.marks.length], until: ([marksA, marksB]) => marksA === 3 && marksB === 3 });
  // Apart first, so no dot covers another: A walks east, B south.
  await hold(tabA, 'KeyD', 1500);
  await hold(tabB, 'KeyS', 1200);
  await settled(tabA, tabB);

  const stateA = await stateOf(tabA);
  const stateB = await stateOf(tabB);
  report.apart = { stateA, stateB };
  for (const [name, own, theirs, page] of [
    ['A', stateA, stateB, tabA],
    ['B', stateB, stateA, tabB],
  ]) {
    const picture = await pictureOf(page);
    const [startingPoint, otherPlayer, localPlayer] = own.minimap.marks;
    const centre = { x: own.minimap.rect.x + own.minimap.rect.width / 2, y: own.minimap.rect.y + own.minimap.rect.height / 2 };
    const theirColor = await clothesColorOf(page, theirs.player.eid);
    const expected = onScreen(own, theirs.drawnAt);
    results.push(check(`${name} is in the middle of its own minimap, in white, centred on where its last frame drew it`, localPlayer.isLocalPlayer && localPlayer.eid === own.player.eid && own.minimap.centre.x === own.drawnAt.x && own.minimap.centre.y === own.drawnAt.y && Math.hypot(localPlayer.x - centre.x, localPlayer.y - centre.y) <= 1 && picture.colorAt(localPlayer.x, localPlayer.y) === own.minimap.localPlayerColor, `centre ${JSON.stringify(own.minimap.centre)}, drawn at ${JSON.stringify(own.drawnAt)}`));
    results.push(check(`${name} sees the other player as a dot in the colour of the other's clothes, where the other is`, otherPlayer.source === 'entity' && !otherPlayer.isLocalPlayer && otherPlayer.eid === theirs.player.eid && otherPlayer.color === theirColor && Math.hypot(otherPlayer.x - expected.x, otherPlayer.y - expected.y) <= 1 && picture.colorAt(otherPlayer.x, otherPlayer.y) === theirColor, `dot at (${otherPlayer.x.toFixed(1)}, ${otherPlayer.y.toFixed(1)}), the other stands at (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}) on this minimap; pixel ${hex(picture.colorAt(otherPlayer.x, otherPlayer.y))}, clothes ${hex(theirColor)}`));
    results.push(check(`${name} sees the starting point marked on the spawn tile`, startingPoint.source === 'landmark' && !startingPoint.onEdge && Math.hypot(startingPoint.x - onScreen(own, own.spawn).x, startingPoint.y - onScreen(own, own.spawn).y) <= 1));
  }
  await saveProofPictures(tabA, '04-online-A-before');
  await saveProofPictures(tabB, '04-online-B-before');

  // ---- B walks: its dot moves on A's minimap ----
  const dotOfB = async () => (await stateOf(tabA)).minimap.marks.find((mark) => mark.source === 'entity' && !mark.isLocalPlayer);
  const before = await dotOfB();
  await tabB.keyboard.down('KeyD');
  const during = [];
  for (let sample = 0; sample < 4; sample += 1) {
    await tabB.waitForTimeout(400);
    during.push((await dotOfB()).x);
  }
  await tabB.keyboard.up('KeyD');
  await standStill(tabB);
  await settled(tabA, tabB);
  const after = await dotOfB();
  const walkedB = await stateOf(tabB);
  const walkedA = await stateOf(tabA);
  report.walked = { walkedA, walkedB, before, during, after };
  const metres = walkedB.drawnAt.x - stateB.drawnAt.x;
  const pixels = after.x - before.x;
  results.push(check('while B walks east its dot moves east on A\'s minimap, sample after sample', during.every((x, index) => x > (index === 0 ? before.x : during[index - 1])), `${before.x.toFixed(1)} -> ${during.map((x) => x.toFixed(1)).join(' -> ')}`));
  results.push(check('and it ends as many pixels east as the tiles B walked, while A\'s minimap stayed put', metres > 5 && Math.abs(pixels - metres * walkedA.minimap.cssPixelsPerTile) <= 1 && Math.abs(after.y - before.y) <= 1 && walkedA.minimap.centre.x === stateA.minimap.centre.x && walkedA.minimap.centre.y === stateA.minimap.centre.y, `B walked ${metres.toFixed(2)} m; its dot moved ${pixels.toFixed(1)} px at ${walkedA.minimap.cssPixelsPerTile} px a tile`));
  const dotOfA = walkedB.minimap.marks.find((mark) => mark.source === 'entity' && !mark.isLocalPlayer);
  const expectedA = onScreen(walkedB, walkedA.drawnAt);
  results.push(check('on B\'s own minimap the terrain moved instead, and A\'s dot is still where A stands', walkedB.minimap.centre.x === walkedB.drawnAt.x && Math.hypot(dotOfA.x - expectedA.x, dotOfA.y - expectedA.y) <= 1, `A's dot at (${dotOfA.x.toFixed(1)}, ${dotOfA.y.toFixed(1)}), expected (${expectedA.x.toFixed(1)}, ${expectedA.y.toFixed(1)})`));
  await saveProofPictures(tabA, '04-online-A-after-B-walked');
  await saveProofPictures(tabB, '04-online-B-after-walking');
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('04-online.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Where a point of the world (metres) is drawn on a tab's minimap, in CSS pixels. */
function onScreen({ minimap }, position) {
  return { x: minimap.worldOriginOnScreen.x + position.x * minimap.cssPixelsPerTile, y: minimap.worldOriginOnScreen.y + position.y * minimap.cssPixelsPerTile };
}

/** Waits until each tab draws the other where the other draws itself: the server states have caught up with both. */
async function settled(tabA, tabB) {
  await waitFor('both tabs to agree on where everyone stands', {
    read: async () => {
      const [stateA, stateB] = [await stateOf(tabA), await stateOf(tabB)];
      const seenByA = stateA.minimap.marks.find((mark) => mark.source === 'entity' && !mark.isLocalPlayer);
      const seenByB = stateB.minimap.marks.find((mark) => mark.source === 'entity' && !mark.isLocalPlayer);
      if (!seenByA || !seenByB || !stateA.drawnAt || !stateB.drawnAt) return false;
      const whereB = onScreen(stateA, stateB.drawnAt);
      const whereA = onScreen(stateB, stateA.drawnAt);
      return Math.hypot(seenByA.x - whereB.x, seenByA.y - whereB.y) <= 0.5 && Math.hypot(seenByB.x - whereA.x, seenByB.y - whereA.y) <= 0.5;
    },
    until: Boolean,
    timeoutMs: 8000,
  });
}
