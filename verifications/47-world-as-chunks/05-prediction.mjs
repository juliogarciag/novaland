/* global window */
/**
 * V5: online with prediction on, terrain stops the local player with no
 * visible correction. The real room server, the real client, and a slow link
 * between them (300 ms of round trip), in Chromium.
 *
 * The prediction is a second sim in the browser. It gets no terrain from the
 * server any more: it builds the colliders from the page's own map. If it
 * built none, or other ones, the drawn player would walk on into the forest
 * for a round trip (about a metre) and be pulled back when the server's
 * state arrived. So the player walks north into the trees and, sampled every
 * frame, must never be drawn past the tree's face, never be moved back, and
 * the largest correction a reconciliation made must stay at the tick or two
 * of walking that starting to move already costs (ADR 0011).
 *
 * It also proves the id question: the server's first player has entity id 1,
 * the id a prediction used to give a tree, and the prediction adopts it.
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { PLAY_VIEWPORT, openGame, startClient, startRoomServer } from './browser.mjs';
import { PROOF, check, summarize, writeProof } from './lib.mjs';
import { startSlowLink } from './slow-link.mjs';

const SERVER_PORT = 5950;
const LINK_PORT = 5951;
const CLIENT_PORT = 5952;
const ROUND_TRIP_MS = 300;
const results = [];
const report = { roundTripMs: ROUND_TRIP_MS };
const errors = [];
const servers = [];
let browser;
let link;
try {
  servers.push(await startRoomServer({ port: SERVER_PORT }));
  link = await startSlowLink({ listenPort: LINK_PORT, targetPort: SERVER_PORT, roundTripMs: ROUND_TRIP_MS });
  servers.push(await startClient({ port: CLIENT_PORT, env: { VITE_SERVER_URL: `ws://localhost:${LINK_PORT}` } }));
  browser = await chromium.launch();
  const page = await openGame(browser, { port: CLIENT_PORT, viewport: PLAY_VIEWPORT, online: true, errors });
  await page.waitForFunction(() => window.__novaland.online.prediction()?.predicting === true && window.__novaland.online.latencyMs() !== undefined, null, { timeout: 20000 });

  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const entity = api.snapshot().entities.find((candidate) => candidate.components.Player?.slot === slot);
    const def = api.defs.find((candidate) => candidate.id === entity.components.DefRef.id);
    const isSolid = (tile) => api.defs.find((candidate) => candidate.id === api.tileDefIdAt(tile))?.solid === true;
    const tile = api.tileAt(entity.components.Position.x, entity.components.Position.y);
    let row = tile.row;
    while (!isSolid({ column: tile.column, row })) row -= 1;
    return { eid: entity.id, start: entity.components.Position, radius: def.radius, speed: def.speed, dt: api.sim.dt, treeFace: (row + 1) * api.tiles.tileSize, latencyMs: api.online.latencyMs(), worldStateEntities: api.snapshot().entities.length, mapChecksum: api.tiles.checksum };
  });
  report.content = content;
  results.push(check(`the link is slow: the HUD's round trip is about ${ROUND_TRIP_MS} ms`, content.latencyMs > ROUND_TRIP_MS * 0.8 && content.latencyMs < ROUND_TRIP_MS * 1.6, `${content.latencyMs} ms`));
  results.push(check('the replica holds the player and nothing else: no terrain came over the wire', content.worldStateEntities === 1, `${content.worldStateEntities} entities`));
  results.push(check('the local player has entity id 1, which a prediction used to give a tree, and is predicted', content.eid === 1, `eid ${content.eid}`));

  // ---- Walk north into the forest, sampling what is drawn every frame ----
  await page.evaluate(() => {
    const api = window.__novaland;
    window.__samples = [];
    const sample = () => {
      const drawn = api.online.localPlayerDrawnAt();
      const prediction = api.online.prediction();
      const slot = api.localSlot();
      const server = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot)?.components.Position;
      if (drawn && prediction && server) window.__samples.push({ at: window.performance.now(), drawnY: drawn.y, drawnX: drawn.x, serverY: server.y, predicting: prediction.predicting, largestCorrection: prediction.largestCorrectionMetres, correction: prediction.correctionMetres });
      window.__sampling = window.requestAnimationFrame(sample);
    };
    sample();
  });
  await page.keyboard.down('KeyW');
  const stopY = content.treeFace + content.radius;
  await page.waitForFunction((y) => window.__samples.length > 0 && Math.abs(window.__samples.at(-1).drawnY - y) < 0.05, stopY, { timeout: 20000 });
  // Keep pushing into the tree for two seconds: several round trips of server states arrive meanwhile.
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(PROOF, '05-prediction-pushing-into-tree.png') });
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1000);
  const samples = await page.evaluate(() => {
    window.cancelAnimationFrame(window.__sampling);
    return window.__samples;
  });

  const walkPerTick = content.speed * content.dt;
  const walkPerRoundTrip = content.speed * (ROUND_TRIP_MS / 1000);
  const firstContact = samples.findIndex((sample) => sample.drawnY < stopY + 0.05);
  const beforeContact = samples.slice(0, firstContact);
  const atTree = samples.slice(firstContact);
  const northmost = Math.min(...samples.map((sample) => sample.drawnY));
  const largestBefore = Math.max(0, ...beforeContact.map((sample) => sample.largestCorrection));
  const largestAfter = Math.max(...samples.map((sample) => sample.largestCorrection));
  const furthestBackAtTree = Math.max(...atTree.map((sample) => sample.drawnY)) - stopY;
  const drawnAheadOfServer = Math.max(...beforeContact.map((sample) => sample.serverY - sample.drawnY));
  const last = samples.at(-1);
  Object.assign(report, { samples: samples.length, stopY, walkPerTick, walkPerRoundTrip, northmost, largestBefore, largestAfter, furthestBackAtTree, drawnAheadOfServer, last });

  results.push(check('the walk was predicted all the way: every frame drew the predicted player', samples.length > 100 && samples.every((sample) => sample.predicting), `${samples.length} frames`));
  results.push(check('while walking the drawn player ran ahead of the server by about a round trip of walking, so a missing tree would have shown', drawnAheadOfServer > walkPerRoundTrip * 0.6, `${drawnAheadOfServer.toFixed(3)} m ahead; a round trip of walking is ${walkPerRoundTrip.toFixed(3)} m`));
  results.push(check('the drawn player never entered the tree: it stops at the face plus its radius', northmost > stopY - 0.03, `northmost drawn y ${northmost.toFixed(4)}, the stop is ${stopY}`));
  results.push(check('once at the tree it is never moved back, while states a round trip old keep arriving', furthestBackAtTree < 0.05, `${furthestBackAtTree.toFixed(4)} m`));
  results.push(check('hitting the tree added no correction: the largest one is what it was before contact, a tick or two of walking', largestAfter <= Math.max(largestBefore, 2 * walkPerTick) + 1e-9 && largestAfter < walkPerRoundTrip / 4, `before contact ${largestBefore.toFixed(4)} m, in all ${largestAfter.toFixed(4)} m; one tick of walking is ${walkPerTick.toFixed(4)} m, a round trip ${walkPerRoundTrip.toFixed(3)} m`));
  results.push(check('at rest the drawn player is exactly where the server has it, with nothing left to correct', Math.abs(last.drawnY - last.serverY) < 1e-6 && last.correction === 0 && Math.abs(last.serverY - stopY) < 0.03, `drawn ${last.drawnY.toFixed(4)}, server ${last.serverY.toFixed(4)}`));
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  await link?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('05-prediction.json', report);
process.exit(summarize(results) ? 0 : 1);
