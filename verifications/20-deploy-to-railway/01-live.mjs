/**
 * The deployed game, from a player's side: given the public URL, /health
 * answers over it, a foreign origin is refused, two Chromium contexts open the
 * URL and are seated in two seats of the one world, each page's key presses
 * move its avatar in the authoritative world (a Node observer of the room is
 * the witness: production pages have no debug API) while the other page
 * receives the deltas that carry the movement. A side-by-side screenshot of
 * both pages is the visual proof that each one draws the other's avatar: no
 * check here can read pixels for that, so a person looks at the PNG.
 *
 * Usage: node 01-live.mjs <url>   e.g. node 01-live.mjs https://novaland-production.up.railway.app
 * Writes proof/01-live-<label>.json, proof/01-live-<label>-two-players.png and one PNG per page.
 * <label> is "railway" for an https URL and "local" otherwise, so a dry run against Docker keeps its own files.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, summarize } from '../19-one-process/lib.mjs';
import { framesBetween, mean, openPlayer, othersSeenBy, startObserver, waitFor, waitSeated, walk } from '../19-one-process/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROOF = path.join(HERE, 'proof');
const FOREIGN_ORIGIN = 'https://evil.example.com';

if (!URL.canParse(process.argv[2] ?? '')) {
  console.error('usage: node 01-live.mjs <url>   e.g. node 01-live.mjs https://novaland-production.up.railway.app');
  process.exit(1);
}
const url = new URL(process.argv[2]);
const base = url.origin;
const label = url.protocol === 'https:' ? 'railway' : 'local';
const proofFile = (name) => path.join(PROOF, `01-live-${label}${name}`);
mkdirSync(PROOF, { recursive: true });

const results = [];
const report = { url: base, startedAt: new Date().toISOString() };
let observer;
let browser;
try {
  const healthResponse = await fetch(`${base}/health`);
  const health = await healthResponse.json();
  report.health = { status: healthResponse.status, body: health };
  results.push(check(`GET ${base}/health answers 200 with the world room and its five seats`, healthResponse.status === 200 && health.ok === true && health.roomId === 'world' && health.seats === 5, JSON.stringify(health)));

  const foreignPreflight = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: FOREIGN_ORIGIN } });
  const foreignRead = await fetch(`${base}/health`, { headers: { origin: FOREIGN_ORIGIN } });
  report.foreignOrigin = { preflight: foreignPreflight.status, allowOrigin: foreignRead.headers.get('access-control-allow-origin') };
  results.push(check(`a matchmaking preflight from ${FOREIGN_ORIGIN} is refused with 403, and no answer carries a CORS header for it`, foreignPreflight.status === 403 && foreignPreflight.headers.get('access-control-allow-origin') === null && foreignRead.headers.get('access-control-allow-origin') === null, JSON.stringify(report.foreignOrigin)));

  const index = await fetch(`${base}/`);
  report.indexHeaders = Object.fromEntries(['content-type', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security'].map((name) => [name, index.headers.get(name)]));
  results.push(check('the page is served with its CSP, nosniff and DENY framing', index.status === 200 && /default-src 'self'/.test(report.indexHeaders['content-security-policy'] ?? '') && report.indexHeaders['x-frame-options'] === 'DENY' && report.indexHeaders['x-content-type-options'] === 'nosniff', JSON.stringify(report.indexHeaders)));

  // The observer joins the room on the same URL (wss:// for https) and reports every player it sees.
  observer = startObserver(base);
  await waitFor(() => observer.slot, (slot) => slot !== undefined, 'the observer to be welcomed', 30000);
  const strangers = othersSeenBy(observer).length; // a live world may already hold players
  report.playersBefore = strangers;

  browser = await chromium.launch();
  const playerA = await openPlayer(browser, 'A', `${base}/`);
  const playerB = await openPlayer(browser, 'B', `${base}/`);
  const playerASeated = await waitSeated(playerA.page);
  const playerBSeated = await waitSeated(playerB.page);
  const seated = await waitFor(() => othersSeenBy(observer), (players) => players.length === strangers + 2, 'the observer to see both pages seated', 30000);
  results.push(check('two browser contexts on the public URL are seated in two seats of the one world (observer), screens hidden, canvases drawing', playerASeated.screen === null && playerBSeated.screen === null && playerASeated.canvas && playerBSeated.canvas && new Set(seated.map((player) => player.slot)).size === seated.length, JSON.stringify({ playerASeated, playerBSeated, seated })));
  results.push(check('window.__novaland is absent on both pages (production build)', playerASeated.hasDebugApi === false && playerBSeated.hasDebugApi === false));
  await playerA.page.waitForTimeout(1500); // the drawn frame catches up; avatars that spawned close finish being pushed apart

  const playerAWalkFrom = Date.now();
  const playerAWalk = await walk(playerA.page, 'KeyD', { x: 1, y: 0 }, observer);
  const playerAWalkTo = Date.now();
  await playerB.page.waitForTimeout(1500);
  const playerBQuietFrames = framesBetween(playerB, Date.now() - 1000, Date.now());
  const playerBFramesDuringAWalk = framesBetween(playerB, playerAWalkFrom, playerAWalkTo);
  results.push(check("holding D on page A moves A's avatar east in the authoritative world", playerAWalk.start && playerAWalk.end && playerAWalk.end.x - playerAWalk.start.x > 0.5 && Math.abs(playerAWalk.end.y - playerAWalk.start.y) < 0.3, JSON.stringify(playerAWalk)));
  results.push(check(`page B receives the deltas carrying A's movement (${playerBFramesDuringAWalk.length} frames of mean ${mean(playerBFramesDuringAWalk).toFixed(0)} bytes, against ${playerBQuietFrames.length} quiet frames of mean ${mean(playerBQuietFrames).toFixed(0)} bytes)`, playerBFramesDuringAWalk.length >= 5 && playerBQuietFrames.length >= 5 && mean(playerBFramesDuringAWalk) > mean(playerBQuietFrames) * 1.3));

  const playerBWalkFrom = Date.now();
  const playerBWalk = await walk(playerB.page, 'KeyS', { x: 0, y: 1 }, observer);
  const playerBWalkTo = Date.now();
  await playerA.page.waitForTimeout(1500);
  const playerAQuietFrames = framesBetween(playerA, Date.now() - 1000, Date.now());
  const playerAFramesDuringBWalk = framesBetween(playerA, playerBWalkFrom, playerBWalkTo);
  results.push(check("holding S on page B moves B's avatar south, a different seat from A's", playerBWalk.slot !== playerAWalk.slot && playerBWalk.start && playerBWalk.end && playerBWalk.end.y - playerBWalk.start.y > 0.5, JSON.stringify(playerBWalk)));
  results.push(check(`page A receives the deltas carrying B's movement (${playerAFramesDuringBWalk.length} frames of mean ${mean(playerAFramesDuringBWalk).toFixed(0)} bytes, against ${playerAQuietFrames.length} quiet frames of mean ${mean(playerAQuietFrames).toFixed(0)} bytes)`, playerAFramesDuringBWalk.length >= 5 && playerAQuietFrames.length >= 5 && mean(playerAFramesDuringBWalk) > mean(playerAQuietFrames) * 1.3));
  report.walks = { playerAWalk, playerBWalk };

  const playerAShot = proofFile('-A.png');
  const playerBShot = proofFile('-B.png');
  await playerA.page.screenshot({ path: playerAShot });
  await playerB.page.screenshot({ path: playerBShot });
  const twoPlayers = proofFile('-two-players.png');
  await composeSideBySide(browser, { left: playerAShot, right: playerBShot, caption: `${base} at ${new Date().toISOString()}`, output: twoPlayers });
  console.log(`captured both pages side by side for a person to look at: ${path.relative(HERE, twoPlayers)}`);

  const failed = [...playerA.failedResponses, ...playerB.failedResponses];
  const errors = [...playerA.consoleErrors, ...playerA.pageErrors, ...playerB.consoleErrors, ...playerB.pageErrors];
  results.push(check('every asset both pages requested came back without an error, and neither page logged one', failed.length === 0 && errors.length === 0, JSON.stringify({ failed, errors })));
  await playerA.context.close();
  await playerB.context.close();
  const freed = await waitFor(() => othersSeenBy(observer), (players) => players.length === strangers, 'the seats to be freed', 30000);
  results.push(check('closing both pages frees their seats', freed.length === strangers));
} catch (error) {
  results.push(check('the live run completes', false, String(error?.stack ?? error)));
} finally {
  observer?.stop();
  if (browser) await browser.close();
}
report.results = results;
writeFileSync(proofFile('.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Writes one PNG that shows two page screenshots next to each other, labelled, with a caption. */
async function composeSideBySide(browser, { left, right, caption, output }) {
  const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 1960, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:16px system-ui">
    <div style="display:flex;gap:40px;padding:12px 0 0 0">
      <figure style="margin:0"><figcaption>Player A</figcaption><img src="${dataUrl(left)}"></figure>
      <figure style="margin:0"><figcaption>Player B</figcaption><img src="${dataUrl(right)}"></figure>
    </div><p style="margin:8px 0">${caption}</p></body>`);
  await page.screenshot({ path: output, fullPage: true });
  await page.close();
}
