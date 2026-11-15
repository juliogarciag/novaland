/* global window, requestAnimationFrame */
/**
 * V2: the ticket's "Done when", measured in Chromium against the real room
 * server and the real client, with a proxy between them that adds latency
 * (latency-proxy.mjs): 100 ms and 300 ms of round trip.
 *
 * At each latency, with prediction on (the default) and off
 * (`VITE_PREDICTION=off`, the comparison):
 *   - the time from a key press to the first frame whose sprite of the
 *     local player is at least one drawn pixel from where it stood, over
 *     several presses. Both times are read in the page: the key press in a
 *     capture-phase listener, the frame in a requestAnimationFrame callback
 *     that runs after the scene's own. What it leaves out is the time the
 *     browser takes to present a frame, the same with and without
 *     prediction;
 *   - after the key is released, the drawn position ends on the server's;
 *   - the HUD's latency figure is the injected round trip either way.
 * With prediction on, also:
 *   - a move the server never receives (the proxy loses it) is drawn at
 *     once, and corrected: the player ends where the server has it, both
 *     when a later move is acknowledged and when the lost one is given up
 *     while the key is still down;
 *   - two players see each other move, and each draws the other from server
 *     states (behind its replica) while drawing itself ahead.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { startLatencyProxy } from './latency-proxy.mjs';
import { PROOF, ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5945;
const PROXY_PORT = 5946;
const PREDICTED_CLIENT_PORT = 5947;
const UNPREDICTED_CLIENT_PORT = 5948;
const ROUND_TRIPS_MS = [100, 300];
const PRESSES = 8;
const HOLD_MS = 350;
const VIEWPORT = { width: 960, height: 720 };
const results = [];
const report = { roundTrips: {} };
const pageErrors = [];

const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT) } });
const clientEnv = { VITE_SERVER_URL: `ws://localhost:${PROXY_PORT}` };
const predictedClient = start('pnpm', ['dev'], { env: { ...clientEnv, PORT: String(PREDICTED_CLIENT_PORT) } });
const unpredictedClient = start('pnpm', ['dev'], { env: { ...clientEnv, PORT: String(UNPREDICTED_CLIENT_PORT), VITE_PREDICTION: 'off' } });
let browser;
let proxy;
try {
  proxy = await startLatencyProxy({ listenPort: PROXY_PORT, targetPort: SERVER_PORT, roundTripMs: 0 });
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(PREDICTED_CLIENT_PORT)) && (await waitForPort(UNPREDICTED_CLIENT_PORT));
  const bootLine = portsUp && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean }).catch(() => undefined));
  results.push(check('room server, latency proxy and both dev servers (prediction on, prediction off) up, started by this run', Boolean(bootLine), bootLine || `${lastLinesOf(roomServer.output)} | ${lastLinesOf(predictedClient.output)} | ${lastLinesOf(unpredictedClient.output)}`));
  if (!bootLine) throw new Error('nothing to open');
  browser = await chromium.launch();

  for (const roundTripMs of ROUND_TRIPS_MS) {
    proxy.setRoundTripMs(roundTripMs);
    const label = `${roundTripMs} ms round trip`;
    const measured = { predicted: undefined, unpredicted: undefined };

    // ---- Prediction on ----
    const tab = await openTab(`predicted-${roundTripMs}`, PREDICTED_CLIENT_PORT);
    await tab.waitForFunction(() => window.__novaland.online.prediction()?.predicting === true && window.__novaland.online.latencyMs() !== undefined, null, { timeout: 20000 });
    const predicted = await pressAndMeasure(tab, roundTripMs);
    measured.predicted = predicted;
    const frameMs = predicted.frameMs;
    results.push(check(`${label}, prediction on: the local player is drawn moving within two frames of every key press`, predicted.delaysMs.length === PRESSES && Math.max(...predicted.delaysMs) <= 2 * frameMs + 4, `delays ${fmt(predicted.delaysMs)} ms, a frame is ${frameMs.toFixed(1)} ms`));
    results.push(check(`${label}, prediction on: after every release the drawn position ends on the server's, with nothing left to acknowledge or correct`, predicted.settled.every((settle) => settle.distance < 1e-3 && settle.unacknowledgedMoves === 0 && settle.correctionMetres === 0), `largest distance ${Math.max(...predicted.settled.map((settle) => settle.distance)).toExponential(1)} m`));
    results.push(check(`${label}, prediction on: while walking the drawn player runs ahead of the server's state, and reconciling only ever corrects by a few ticks of movement`, predicted.furthestAheadMetres > 0.1 && predicted.report.largestCorrectionMetres < 0.6 && predicted.report.reconciliations > 50, JSON.stringify({ furthestAheadMetres: round(predicted.furthestAheadMetres), ...predicted.report })));
    results.push(check(`${label}, prediction on: the HUD latency figure is the round trip the proxy adds, not hidden by prediction`, Math.abs(predicted.hudLatencyMs - roundTripMs) <= 40, `${predicted.hudLatencyMs} ms shown`));
    await tab.screenshot({ path: path.join(PROOF, `02-latency-${roundTripMs}ms-predicted.png`) });

    // A move the server never receives, then a release it does: the walk is drawn at once and taken back when the release is acknowledged.
    const lostThenReleased = await loseAMove(tab, { holdMs: 500, roundTripMs });
    // An unacknowledged move is replayed over the ticks the client runs ahead, so the guess goes about one round trip of walking and no further.
    const roundTripOfWalking = (roundTripMs / 1000) * predicted.speed;
    const boundedGuess = (walk) => walk.furthestFromServer > 0.8 * roundTripOfWalking && walk.furthestFromServer < roundTripOfWalking + 1;
    results.push(check(`${label}, forced disagreement: a move the server never received is drawn at once, about one round trip of walking ahead and no further, and taken back once the next move is acknowledged`, lostThenReleased.dropped === 1 && boundedGuess(lostThenReleased) && lostThenReleased.serverMoved < 1e-6 && lostThenReleased.endDistance < 1e-3 && lostThenReleased.backAtStart < 1e-3, JSON.stringify({ roundTripOfWalking: round(roundTripOfWalking), ...roundAll(lostThenReleased) })));
    // The same with the key held past the second a guess may last: the client gives the move up by itself.
    const lostAndHeld = await loseAMove(tab, { holdMs: 2200, roundTripMs });
    results.push(check(`${label}, forced disagreement: with the key still down the lost move is given up after about a second and the player is drawn back on the server's position`, lostAndHeld.dropped === 1 && boundedGuess(lostAndHeld) && lostAndHeld.distanceWhileStillHeld < 0.05 && lostAndHeld.endDistance < 1e-3, JSON.stringify(roundAll(lostAndHeld))));
    results.push(check(`${label}, forced disagreement: the correction is spread over frames, never one jump`, lostAndHeld.largestStepBackMetres < lostAndHeld.furthestFromServer / 2 && lostAndHeld.framesMovingBack >= 4, JSON.stringify({ largestStepBackMetres: round(lostAndHeld.largestStepBackMetres), framesMovingBack: lostAndHeld.framesMovingBack })));
    const afterwards = await pressAndMeasure(tab, roundTripMs, 2);
    results.push(check(`${label}, forced disagreement: the next moves are predicted and settle as before`, afterwards.delaysMs.length === 2 && Math.max(...afterwards.delaysMs) <= 2 * frameMs + 4 && afterwards.settled.every((settle) => settle.distance < 1e-3), `delays ${fmt(afterwards.delaysMs)} ms`));

    // ---- Two players ----
    const other = await openTab(`other-${roundTripMs}`, PREDICTED_CLIENT_PORT);
    await other.waitForFunction(() => window.__novaland.online.prediction()?.predicting === true, null, { timeout: 20000 });
    await waitFor('both tabs to see two players', { read: async () => [await playersIn(tab), await playersIn(other)], until: ([mine, theirs]) => mine === 2 && theirs === 2 });
    const seen = await seeEachOther(tab, other, roundTripMs);
    results.push(check(`${label}, two players: each sees the other walk and both end on the same positions`, seen.watcherSawMoverMove > 1 && seen.moverSawWatcherMove > 1 && seen.disagreement < 1e-3, JSON.stringify(roundAll(seen))));
    results.push(check(`${label}, two players: the other player is drawn from server states (behind the replica) while the local one is drawn ahead of it`, seen.otherDrawnBehindReplica > 0.05 && seen.selfDrawnAheadOfReplica > 0.1, JSON.stringify({ otherDrawnBehindReplica: round(seen.otherDrawnBehindReplica), selfDrawnAheadOfReplica: round(seen.selfDrawnAheadOfReplica) })));
    await tab.screenshot({ path: path.join(PROOF, `02-latency-${roundTripMs}ms-two-players.png`) });
    await other.context().close();
    await tab.context().close();

    // ---- Prediction off: what the same latency feels like without it ----
    const plain = await openTab(`unpredicted-${roundTripMs}`, UNPREDICTED_CLIENT_PORT);
    await plain.waitForFunction(() => window.__novaland.online.latencyMs() !== undefined, null, { timeout: 20000 });
    const unpredicted = await pressAndMeasure(plain, roundTripMs);
    measured.unpredicted = unpredicted;
    results.push(check(`${label}, prediction off: the same presses wait for the round trip (the latency is real, and prediction is what hides it)`, unpredicted.noPrediction && unpredicted.delaysMs.length === PRESSES && Math.min(...unpredicted.delaysMs) >= roundTripMs && median(unpredicted.delaysMs) > median(predicted.delaysMs) + roundTripMs, `delays ${fmt(unpredicted.delaysMs)} ms`));
    results.push(check(`${label}, prediction off: the HUD latency figure is the same`, Math.abs(unpredicted.hudLatencyMs - roundTripMs) <= 40 && Math.abs(unpredicted.hudLatencyMs - predicted.hudLatencyMs) <= 40, `${unpredicted.hudLatencyMs} ms shown, ${predicted.hudLatencyMs} ms with prediction`));
    await plain.screenshot({ path: path.join(PROOF, `02-latency-${roundTripMs}ms-unpredicted.png`) });
    await plain.context().close();

    report.roundTrips[roundTripMs] = {
      keyPressToMotionMs: {
        predicted: { each: predicted.delaysMs.map(round), median: round(median(predicted.delaysMs)), worst: round(Math.max(...predicted.delaysMs)) },
        unpredicted: { each: unpredicted.delaysMs.map(round), median: round(median(unpredicted.delaysMs)), worst: round(Math.max(...unpredicted.delaysMs)) },
        frameMs: round(frameMs),
      },
      predicted: { settled: predicted.settled, report: predicted.report, furthestAheadMetres: round(predicted.furthestAheadMetres), hudLatencyMs: predicted.hudLatencyMs },
      unpredicted: { settled: unpredicted.settled, hudLatencyMs: unpredicted.hudLatencyMs },
      lostThenReleased: roundAll(lostThenReleased),
      lostAndHeld: roundAll(lostAndHeld),
      twoPlayers: roundAll(seen),
    };
    console.log(`     ${label}: key press to motion, median ${round(median(predicted.delaysMs))} ms predicted against ${round(median(unpredicted.delaysMs))} ms unpredicted`);
  }
  results.push(check('no page errors and no console errors in any tab', pageErrors.length === 0, pageErrors.join(' | ')));
  report.proxy = proxy.counts;
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  await proxy?.close();
  roomServer.stop();
  predictedClient.stop();
  unpredictedClient.stop();
}

report.results = results;
writeProof('02-latency.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** A tab of its own browser context (its own player), seated in the world, with a probe that records every frame's drawn position and every key press. */
async function openTab(name, clientPort) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${name}: ${message.text()}`));
  await page.goto(`http://localhost:${clientPort}/`);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 20000 });
  await page.evaluate(() => {
    const api = window.__novaland;
    const probe = { frames: [], keyDowns: [], keyUps: [] };
    window.__probe = probe;
    /** Where the replica (the last server state) has the player in `slot`. */
    probe.serverPositionOf = (slot) => api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot)?.components.Position;
    /** Where the scene drew the player in `slot`, in metres. */
    probe.drawnPositionOf = (slot) => {
      const entity = api.snapshot().entities.find((candidate) => candidate.components.Player?.slot === slot);
      // Nothing until the scene has built its renderer and drawn the entity once.
      const pixels = entity && api.game.scene.getScene('world')?.entityRenderer?.pixelPositionOf(entity.id);
      return pixels && { x: pixels.x / api.pixelsPerMetre, y: pixels.y / api.pixelsPerMetre };
    };
    window.addEventListener('keydown', (event) => !event.repeat && probe.keyDowns.push(performance.now()), true);
    window.addEventListener('keyup', () => probe.keyUps.push(performance.now()), true);
    const sample = () => {
      // The sprite's own position, read after the scene drew it: what is on screen, not what the world reported.
      const drawn = probe.drawnPositionOf(api.localSlot());
      const server = probe.serverPositionOf(api.localSlot());
      if (drawn && server) probe.frames.push({ at: performance.now(), x: drawn.x, y: drawn.y, serverX: server.x, serverY: server.y, others: probe.watch ? probe.watch() : undefined });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return page;
}

/**
 * Presses and releases a walking key `presses` times (right, then left, so
 * the player stays where it started) and reads, from the page's own frame
 * record: how long after each key press the drawn position first changed,
 * how far the drawn position ran ahead of the server's while walking, and
 * where everything stood once each walk had settled.
 */
async function pressAndMeasure(page, roundTripMs, presses = PRESSES) {
  const delaysMs = [];
  const settled = [];
  let furthestAheadMetres = 0;
  for (let press = 0; press < presses; press += 1) {
    const key = press % 2 === 0 ? 'KeyD' : 'KeyA';
    await page.evaluate(() => {
      window.__probe.frames.length = 0;
      window.__probe.keyDowns.length = 0;
    });
    await page.waitForTimeout(120);
    await page.keyboard.down(key);
    await page.waitForTimeout(HOLD_MS);
    await page.keyboard.up(key);
    await page.waitForTimeout(roundTripMs + 700);
    const walk = await page.evaluate(() => {
      const { frames, keyDowns } = window.__probe;
      const pressedAt = keyDowns[0];
      const before = frames.filter((frame) => frame.at < pressedAt).at(-1);
      // Moving means at least one drawn pixel away from where it stood.
      const onePixel = 1 / window.__novaland.pixelsPerMetre;
      const firstMoved = frames.find((frame) => frame.at >= pressedAt && Math.hypot(frame.x - before.x, frame.y - before.y) >= onePixel);
      const last = frames.at(-1);
      const report = window.__novaland.online.prediction();
      return {
        delayMs: firstMoved ? firstMoved.at - pressedAt : undefined,
        furthestAhead: Math.max(...frames.map((frame) => Math.hypot(frame.x - frame.serverX, frame.y - frame.serverY))),
        settle: { distance: Math.hypot(last.x - last.serverX, last.y - last.serverY), unacknowledgedMoves: report?.unacknowledgedMoves ?? 0, correctionMetres: report?.correctionMetres ?? 0 },
      };
    });
    if (walk.delayMs !== undefined) delaysMs.push(walk.delayMs);
    settled.push(walk.settle);
    furthestAheadMetres = Math.max(furthestAheadMetres, walk.furthestAhead);
  }
  const summary = await page.evaluate(() => {
    const { frames } = window.__probe;
    const gaps = frames.slice(1).map((frame, index) => frame.at - frames[index].at).sort((a, b) => a - b);
    const api = window.__novaland;
    const self = api.snapshot().entities.find((entity) => entity.components.Player?.slot === api.localSlot());
    const speed = api.defs.find((def) => def.id === self.components.DefRef.id).speed;
    return { frameMs: gaps[Math.floor(gaps.length / 2)], report: api.online.prediction(), hudLatencyMs: api.online.latencyMs(), speed };
  });
  return { delaysMs, settled, furthestAheadMetres, speed: summary.speed, frameMs: summary.frameMs, report: summary.report, noPrediction: summary.report === undefined, hudLatencyMs: summary.hudLatencyMs };
}

/**
 * Has the proxy lose the next room message (the move of the key press), holds
 * the key for `holdMs`, releases it and lets everything settle. Reports how
 * far the drawn player went from the server's, whether the server's ever
 * moved, how far apart they were just before the release and at the end, and
 * how the drawn player came back.
 */
async function loseAMove(page, { holdMs, roundTripMs }) {
  await page.waitForTimeout(roundTripMs + 300);
  const droppedBefore = proxy.counts.dropped;
  await page.evaluate(() => {
    window.__probe.frames.length = 0;
    window.__probe.keyUps.length = 0;
  });
  await page.waitForTimeout(100);
  proxy.dropNextRoomMessages(1);
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(holdMs);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(roundTripMs + 1200);
  const walk = await page.evaluate(() => {
    const { frames, keyUps } = window.__probe;
    const first = frames[0];
    const last = frames.at(-1);
    const apart = (frame) => Math.hypot(frame.x - frame.serverX, frame.y - frame.serverY);
    const furthest = frames.reduce((best, frame) => (apart(frame) > apart(best) ? frame : best), first);
    const stillHeld = frames.filter((frame) => frame.at < keyUps[0]).at(-1);
    const comingBack = frames.slice(frames.indexOf(furthest));
    const stepsBack = comingBack.slice(1).map((frame, index) => apart(comingBack[index]) - apart(frame)).filter((step) => step > 1e-4);
    return {
      furthestFromServer: apart(furthest),
      serverMoved: Math.max(...frames.map((frame) => Math.hypot(frame.serverX - first.serverX, frame.serverY - first.serverY))),
      distanceWhileStillHeld: apart(stillHeld),
      endDistance: apart(last),
      backAtStart: Math.hypot(last.x - first.x, last.y - first.y),
      largestStepBackMetres: Math.max(0, ...stepsBack),
      framesMovingBack: stepsBack.length,
    };
  });
  return { ...walk, dropped: proxy.counts.dropped - droppedBefore };
}

/** Players in the tab's replica. */
function playersIn(page) {
  return page.evaluate(() => window.__novaland.snapshot().entities.filter((entity) => entity.components.Player).length);
}

/**
 * `mover` walks while `watcher` watches, then the other way round. Reports
 * how far each saw the other go, how far apart the two tabs' final positions
 * are, and, on the watcher's page during the mover's walk, how far behind
 * its replica the mover was drawn; on the mover's own page, how far ahead.
 */
async function seeEachOther(mover, watcher, roundTripMs) {
  const slotOf = (page) => page.evaluate(() => window.__novaland.localSlot());
  const moverSlot = await slotOf(mover);
  const watcherSlot = await slotOf(watcher);
  const positionsOn = (page) => page.evaluate(([first, second]) => [window.__probe.serverPositionOf(first), window.__probe.serverPositionOf(second)], [moverSlot, watcherSlot]);
  const walk = async (walker, onlooker, walkerSlot, key) => {
    await onlooker.evaluate((slot) => {
      window.__probe.frames.length = 0;
      window.__probe.watch = () => ({ drawn: window.__probe.drawnPositionOf(slot), replica: window.__probe.serverPositionOf(slot) });
    }, walkerSlot);
    await walker.evaluate(() => (window.__probe.frames.length = 0));
    const [before] = await onlooker.evaluate((slot) => [window.__probe.serverPositionOf(slot)], walkerSlot);
    await walker.keyboard.down(key);
    await walker.waitForTimeout(900);
    await walker.keyboard.up(key);
    await walker.waitForTimeout(roundTripMs + 900);
    const seenByOnlooker = await onlooker.evaluate((slot) => {
      const after = window.__probe.serverPositionOf(slot);
      const trails = window.__probe.frames.filter((frame) => frame.others?.drawn).map((frame) => Math.hypot(frame.others.replica.x - frame.others.drawn.x, frame.others.replica.y - frame.others.drawn.y));
      window.__probe.watch = undefined;
      return { after, furthestBehind: Math.max(0, ...trails) };
    }, walkerSlot);
    const aheadOnOwnPage = await walker.evaluate(() => Math.max(...window.__probe.frames.map((frame) => Math.hypot(frame.x - frame.serverX, frame.y - frame.serverY))));
    return { moved: Math.hypot(seenByOnlooker.after.x - before.x, seenByOnlooker.after.y - before.y), furthestBehind: seenByOnlooker.furthestBehind, aheadOnOwnPage };
  };
  const first = await walk(mover, watcher, moverSlot, 'KeyW');
  const second = await walk(watcher, mover, watcherSlot, 'KeyW');
  const onMover = await positionsOn(mover);
  const onWatcher = await positionsOn(watcher);
  const disagreement = Math.max(...onMover.map((position, index) => Math.hypot(position.x - onWatcher[index].x, position.y - onWatcher[index].y)));
  return { watcherSawMoverMove: first.moved, moverSawWatcherMove: second.moved, disagreement, otherDrawnBehindReplica: first.furthestBehind, selfDrawnAheadOfReplica: first.aheadOnOwnPage };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value) {
  return typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
}

function roundAll(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, round(value)]));
}

function fmt(values) {
  return values.map((value) => value.toFixed(0)).join(', ');
}
