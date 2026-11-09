/* global window, document */
/**
 * V3: online mode against the real room server and the real client, in
 * Chromium. A page opened before the server is up shows the connecting screen
 * and joins by itself once the server boots; two contexts get seats and each
 * sees the other move (replica and drawn sprite), with the drawn position
 * changing far more often than the replica (interpolation) and lagging it by
 * about two send intervals; the HUD counts `n/5 online`; five contexts fill
 * the world and a sixth sees the world-full screen with a retry; closing a
 * context removes its avatar for the others and lets the sixth in; killing
 * the server shows the disconnected screen and restarting it brings every
 * page back; the replica is window.__novaland.sim and never steps.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, isPortOpen, start, summarize, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5318;
const CLIENT_PORT = 5319;
const SEATS = 5;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = { steps: [] };
const errors = [];
const pageErrors = [];
const serverDir = path.join(ROOT, 'packages/server');
const startServer = () => start('pnpm', ['dev'], { cwd: serverDir, env: { PORT: String(SERVER_PORT) } });

const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let server;
let browser;
try {
  results.push(check('client dev server up (VITE_SERVER_URL set, room server not yet started)', await waitForPort(CLIENT_PORT)));
  browser = await chromium.launch();
  const open = async (name) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
    page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`));
    await page.goto(`http://localhost:${CLIENT_PORT}/`);
    return { name, context, page };
  };

  // 1. A page before the server: the connecting screen; then the server boots and the page joins by itself.
  const a = await open('A');
  await a.page.waitForSelector('#screen[data-screen="connecting"], #screen[data-screen="disconnected"]', { timeout: 15000 });
  await a.page.waitForTimeout(300);
  const beforeServer = await screenOf(a.page);
  await a.page.screenshot({ path: path.join(PROOF, '03-online-1-connecting.png') });
  results.push(check('before the server is up the page shows the connecting / retrying screen and no game', (beforeServer.screen === 'connecting' || beforeServer.screen === 'disconnected') && beforeServer.hasApi === false, JSON.stringify(beforeServer)));
  server = startServer();
  results.push(check('room server up', await waitForPort(SERVER_PORT)));
  await waitOnline(a.page, 20000);
  // The HUD and the drawn frame follow the replica a frame or two later (the frame buffer draws ~100 ms behind), so wait for them.
  const aJoined = await waitFor(() => stateOf(a.page), (state) => /online/.test(state.hud) && state.sprites.length === 1, 'A drawn and counted');
  results.push(check('once the server is up the page joins by itself: online, seated, screen hidden, the replica is the sim', aJoined.status.kind === 'online' && aJoined.screen === null && aJoined.isReplica === true && aJoined.ownEntity !== undefined, JSON.stringify({ status: aJoined.status, slot: aJoined.localSlot })));
  results.push(check('the HUD reads 1/5 online with one player', /1\/5 online/.test(aJoined.hud), aJoined.hud));
  const stepped = await a.page.evaluate(() => {
    try {
      window.__novaland.sim.step();
      return 'stepped';
    } catch (error) {
      return String(error);
    }
  });
  results.push(check('the replica never steps: window.__novaland.sim.step() throws', /replica/.test(stepped), stepped));
  report.steps.push({ step: 'first-join', beforeServer, aJoined, stepped });

  // 2. Two players see each other.
  const b = await open('B');
  await waitOnline(b.page);
  const aTwo = await waitFor(() => stateOf(a.page), (state) => state.players.length === 2 && state.sprites.length === 2, 'A sees and draws two players');
  const bTwo = await waitFor(() => stateOf(b.page), (state) => state.players.length === 2 && state.sprites.length === 2, 'B sees and draws two players');
  results.push(check('A and B hold different seats and each sees both avatars', aTwo.localSlot !== bTwo.localSlot && aTwo.players.length === 2 && bTwo.players.length === 2 && aTwo.sprites.length === 2 && bTwo.sprites.length === 2, `A seat ${aTwo.localSlot}, B seat ${bTwo.localSlot}`));
  results.push(check('both HUDs read 2/5 online', /2\/5 online/.test(aTwo.hud) && /2\/5 online/.test(bTwo.hud), `${aTwo.hud} | ${bTwo.hud}`));
  const speed = await a.page.evaluate(() => {
    const api = window.__novaland;
    const own = api.snapshot().entities.find((entity) => entity.components.Player && entity.components.Player.slot === api.localSlot());
    return api.defs.find((def) => def.id === own.components.DefRef.id).speed;
  });
  const sendRate = 20;
  const bufferSeconds = 2 / sendRate;

  // A walks east; B samples A's replica position and A's drawn sprite at the display rate.
  const aEidInB = bTwo.players.find((player) => player.slot === aTwo.localSlot).eid;
  const aStart = bTwo.players.find((player) => player.slot === aTwo.localSlot);
  await a.page.keyboard.down('KeyD');
  await b.page.waitForTimeout(250);
  const samples = [];
  const samplingStarted = Date.now();
  const until = samplingStarted + 700;
  while (Date.now() < until) {
    samples.push(await b.page.evaluate(sampleEntity, aEidInB));
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  const sampledSeconds = (Date.now() - samplingStarted) / 1000;
  await a.page.screenshot({ path: path.join(PROOF, '03-online-2-A-walking.png') });
  await b.page.screenshot({ path: path.join(PROOF, '03-online-3-B-sees-A-walking.png') });
  await a.page.keyboard.up('KeyD');
  await waitFor(() => stateOf(b.page), (state) => state.players.find((player) => player.slot === aTwo.localSlot).intent.x === 0, 'B sees A stop');
  const aEnd = (await stateOf(b.page)).players.find((player) => player.slot === aTwo.localSlot);
  const replicaXs = new Set(samples.map((sample) => sample.replicaX));
  const spriteXs = new Set(samples.map((sample) => sample.spriteX));
  const walking = samples.filter((sample) => sample.intentX === 1);
  const lagPixels = walking.map((sample) => sample.replicaX * sample.pixelsPerMetre - sample.spriteX);
  const meanLag = lagPixels.reduce((sum, lag) => sum + lag, 0) / Math.max(1, lagPixels.length);
  const expectedLag = speed * bufferSeconds * samples[0].pixelsPerMetre;
  results.push(check("B's replica shows A moving east while A holds D", aEnd.x > aStart.x + 0.5 && walking.length > 10, `${aStart.x.toFixed(2)} -> ${aEnd.x.toFixed(2)} over ${walking.length} walking samples`));
  results.push(check("B draws A's sprite moving east, with the walk animation playing", walking.every((sample) => sample.animation && sample.animation.endsWith('/walk/right')) && samples.at(-1).spriteX > samples[0].spriteX, samples.at(-1) && samples.at(-1).animation));
  // The replica changes 20 times a second; the drawn sprite should change on (nearly) every display frame, ~60 a second.
  const displayFrames = sampledSeconds * 60;
  results.push(check(`the drawn position changes far more often than the replica (${spriteXs.size} distinct sprite x vs ${replicaXs.size} replica x in ${sampledSeconds.toFixed(2)} s, ~${displayFrames.toFixed(0)} display frames): 20 Hz updates draw as 60 Hz motion`, spriteXs.size >= replicaXs.size * 2 && spriteXs.size >= displayFrames * 0.6));
  results.push(check(`the drawn sprite lags the replica by about two send intervals (mean ${meanLag.toFixed(1)} px, expected ~${expectedLag.toFixed(1)} px for ${speed} m/s)`, meanLag > expectedLag * 0.5 && meanLag < expectedLag * 2));
  const monotone = samples.every((sample, index) => index === 0 || sample.spriteX >= samples[index - 1].spriteX);
  results.push(check('the drawn position never goes backwards while A walks east', monotone));
  report.steps.push({ step: 'two-players', aTwo, bTwo, speed, sampledSeconds, sampleCount: samples.length, distinctSpriteX: spriteXs.size, distinctReplicaX: replicaXs.size, samples: samples.filter((sample, index) => index % 10 === 0), meanLag, expectedLag });

  // 3. Five fill the world; the sixth sees the world-full screen with a retry button.
  const c = await open('C');
  const d = await open('D');
  const e = await open('E');
  for (const player of [c, d, e]) await waitOnline(player.page);
  await waitFor(() => stateOf(a.page), (state) => state.players.length === SEATS, 'A sees five players');
  const aFive = await stateOf(a.page);
  results.push(check('five contexts are seated in five different seats and the HUD reads 5/5 online', new Set(aFive.players.map((player) => player.slot)).size === SEATS && /5\/5 online/.test(aFive.hud), aFive.hud));
  await a.page.screenshot({ path: path.join(PROOF, '03-online-4-five-online.png') });
  const f = await open('F');
  await f.page.waitForSelector('#screen[data-screen="full"]', { timeout: 15000 });
  const fFull = await screenOf(f.page);
  await f.page.screenshot({ path: path.join(PROOF, '03-online-5-F-world-full.png') });
  results.push(check('the sixth context sees the world-full screen, with the count and a retry button, and no game', fFull.screen === 'full' && /full/i.test(fFull.text) && /5\/5/.test(fFull.text) && fFull.button === true && fFull.hasApi === false, fFull.text));
  await f.page.click('#screen button');
  await f.page.waitForTimeout(1500);
  const fRetried = await screenOf(f.page);
  results.push(check('retrying while still full shows the full screen again', fRetried.screen === 'full' && fRetried.hasApi === false, fRetried.text));
  report.steps.push({ step: 'full', aFive, fFull, fRetried });

  // 4. Closing a context removes its avatar for the others; the sixth gets in on its next retry.
  const eSlot = (await stateOf(e.page)).localSlot;
  const eEidInA = aFive.players.find((player) => player.slot === eSlot).eid;
  const closedAt = Date.now();
  await e.context.close();
  await waitFor(() => stateOf(a.page), (state) => !state.players.some((player) => player.slot === eSlot), 'A no longer sees E');
  const goneAfterMs = Date.now() - closedAt;
  const aFour = await waitFor(() => stateOf(a.page), (state) => state.sprites.length === 4 && /4\/5 online/.test(state.hud), 'A no longer draws E', 3000);
  const drawnGoneAfterMs = Date.now() - closedAt;
  results.push(check(`closing E removed its avatar for A: entity gone after ${goneAfterMs} ms, sprite gone after ${drawnGoneAfterMs} ms, HUD reads 4/5`, !aFour.players.some((player) => player.eid === eEidInA) && aFour.sprites.length === 4 && goneAfterMs < 3000, aFour.hud));
  await waitOnline(f.page, 12000);
  const fIn = await stateOf(f.page);
  results.push(check("F got the freed seat on its next retry and sees everybody", fIn.status.kind === 'online' && fIn.localSlot === eSlot && fIn.players.length === SEATS, `F seat ${fIn.localSlot}, ${fIn.players.length} players`));
  await f.page.screenshot({ path: path.join(PROOF, '03-online-6-F-seated-after-E-left.png') });
  report.steps.push({ step: 'leave', eSlot, goneAfterMs, drawnGoneAfterMs, aFour, fIn });

  // 5. The server dies: every page shows the disconnected screen; it comes back: every page is seated again and can move.
  const tickBeforeKill = (await stateOf(a.page)).tick;
  server.stop();
  await a.page.waitForSelector('#screen[data-screen="disconnected"]', { timeout: 15000 });
  await b.page.waitForSelector('#screen[data-screen="disconnected"]', { timeout: 15000 });
  const aDown = await screenOf(a.page);
  await a.page.screenshot({ path: path.join(PROOF, '03-online-7-A-disconnected.png') });
  results.push(check('killing the server shows the disconnected-and-retrying screen with a retry button; the game stays underneath', aDown.screen === 'disconnected' && /retrying/i.test(aDown.text) && aDown.button === true && aDown.hasApi === true, aDown.text));
  await waitFor(() => isPortOpen(SERVER_PORT), (open) => open === false, 'server port closed');
  await a.page.waitForTimeout(2500);
  const aStillDown = await screenOf(a.page);
  results.push(check('while the server is down the page keeps retrying (still disconnected, no uncaught error)', aStillDown.screen === 'disconnected' || aStillDown.screen === 'connecting', aStillDown.text));
  server = startServer();
  results.push(check('room server restarted', await waitForPort(SERVER_PORT)));
  for (const player of [a, b, c, d, f]) await waitOnline(player.page, 25000);
  const aBack = await stateOf(a.page);
  results.push(check('after the restart every page is seated again, the screen is gone and the world starts over (tick reset)', aBack.status.kind === 'online' && aBack.screen === null && aBack.players.length === SEATS && aBack.tick < tickBeforeKill, `tick ${tickBeforeKill} -> ${aBack.tick}, ${aBack.players.length} players`));
  const bBackStart = (await stateOf(b.page)).players.find((player) => player.slot === aBack.localSlot);
  await a.page.keyboard.down('KeyS');
  await a.page.waitForTimeout(600);
  await a.page.keyboard.up('KeyS');
  await waitFor(() => stateOf(b.page), (state) => state.players.find((player) => player.slot === aBack.localSlot).intent.y === 0, 'B sees A stop');
  const bBackEnd = (await stateOf(b.page)).players.find((player) => player.slot === aBack.localSlot);
  results.push(check('play resumes: A walks south and B sees it', bBackEnd.y > bBackStart.y + 0.5, `${bBackStart.y.toFixed(2)} -> ${bBackEnd.y.toFixed(2)}`));
  await a.page.screenshot({ path: path.join(PROOF, '03-online-8-A-back-online.png') });
  report.steps.push({ step: 'restart', tickBeforeKill, aDown, aStillDown, aBack, bBackStart, bBackEnd });

  const unexpected = errors.filter((line) => !/WebSocket|Failed to fetch|ERR_CONNECTION_REFUSED|net::ERR|Failed to load resource|matchmake|NetworkError/i.test(line));
  results.push(check('no uncaught page errors, and no console errors beyond the browser reporting the server outage', pageErrors.length === 0 && unexpected.length === 0, [...pageErrors, ...unexpected].join(' | ').slice(0, 300)));
  report.errors = { pageErrors, consoleErrors: errors };
} catch (error) {
  results.push(check(`the scenario ran to the end`, false, String(error && error.stack ? error.stack.split('\n').slice(0, 3).join(' ') : error)));
} finally {
  if (browser) await browser.close();
  if (server) server.stop();
  client.stop();
}
writeProof('03-online.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** The connection screen, if shown, and whether the game exists. Works before and after the game boots. */
function screenOf(page) {
  return page.evaluate(() => {
    const screen = document.getElementById('screen');
    const shown = screen && !screen.hidden;
    return {
      screen: shown ? screen.dataset.screen : null,
      text: shown ? screen.querySelector('p').textContent : null,
      button: shown ? !screen.querySelector('button').hidden : null,
      hasApi: Boolean(window.__novaland),
    };
  });
}

/** Sim state, status, HUD and drawn sprites of a seated page, read in one frame. */
function stateOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const screen = document.getElementById('screen');
    const snapshot = api.snapshot();
    const players = snapshot.entities
      .filter((entity) => entity.components.Player)
      .map((entity) => ({ eid: entity.id, slot: entity.components.Player.slot, x: entity.components.Position.x, y: entity.components.Position.y, intent: entity.components.MoveIntent }));
    const scene = api.game.scene.getScene('world');
    const sprites = scene.children.list.filter((object) => object.type === 'Sprite').map((sprite) => ({ x: sprite.x, y: sprite.y, texture: sprite.texture.key }));
    const hud = api.game.scene.getScene('hud').children.list[0];
    return {
      status: api.online.status(),
      localSlot: api.localSlot(),
      ownEntity: players.find((player) => player.slot === api.localSlot()),
      tick: snapshot.tick,
      isReplica: api.sim.isReplica,
      players,
      sprites,
      hud: hud ? hud.text : null,
      screen: screen && !screen.hidden ? screen.dataset.screen : null,
    };
  });
}

/** One sample of entity `eid` on a page: where the replica has it and where it is drawn. Runs in the page. */
function sampleEntity(eid) {
  const api = window.__novaland;
  const entity = api.snapshot().entities.find((candidate) => candidate.id === eid);
  const scene = api.game.scene.getScene('world');
  // The drawn sprite nearest the replica position is this entity's: sprites are not tagged with ids, and the lag is a fraction of a tile.
  const sprites = scene.children.list.filter((object) => object.type === 'Sprite');
  const sprite = sprites
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - entity.components.Position.x * api.pixelsPerMetre, candidate.y - entity.components.Position.y * api.pixelsPerMetre) }))
    .sort((left, right) => left.distance - right.distance)[0].candidate;
  return {
    tick: api.sim.tick,
    replicaX: entity.components.Position.x,
    spriteX: sprite.x,
    intentX: entity.components.MoveIntent.x,
    animation: sprite.anims.currentAnim && sprite.anims.isPlaying ? sprite.anims.currentAnim.key : null,
    pixelsPerMetre: api.pixelsPerMetre,
  };
}

async function waitOnline(page, timeout = 15000) {
  await page.waitForFunction(() => window.__novaland && window.__novaland.online && window.__novaland.online.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout });
}

async function waitFor(read, condition, what, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (condition(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${what} (last: ${JSON.stringify(last).slice(0, 200)})`);
}
