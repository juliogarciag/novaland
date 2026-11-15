/* global window */
/**
 * V5: the minimap costs the same on a map a hundred times the world's size.
 *
 * The same walk (east for four seconds, back west for four: twenty tiles
 * each way, enough to bring new chunks under the minimap on the big map and
 * so to include painting them) is played on the world and on the generated
 * 400x300 map, with the minimap on, in a browser
 * whose frame rate is not capped, so a frame takes as long as it costs.
 * Each map is measured in several rounds, taking turns, each in a fresh
 * page. Two numbers come out of a round:
 *
 * - the frame time: the median gap between two frames;
 * - the minimap's own share: the time spent inside its per-frame call
 *   (`Minimap.show`), per frame.
 *
 * The noise is how much the world's own rounds differ from each other.
 * The big map passes when its frame time is within that noise of the
 * world's (or within 5%, when the rounds agree closer than that), and when
 * the minimap's share is a small fraction of a millisecond on both.
 */
import { chromium } from 'playwright';
import { openGame, saveProofPictures, standStill, startClient } from './browser.mjs';
import { check, summarize, writeProof } from './lib.mjs';

const WORLD_PORT = 5966;
const BIG_PORT = 5967;
const VIEWPORT = { width: 960, height: 720 };
const ROUNDS = 5;
const WALK_MILLISECONDS = 4000;
const results = [];
const report = { rounds: [] };
const errors = [];
const servers = [];
let browser;
try {
  servers.push(await startClient({ port: WORLD_PORT }));
  servers.push(await startClient({ port: BIG_PORT, env: { VITE_GENERATED_MAP: '400x300' } }));
  // Without these a frame waits for the screen's refresh and every map measures 16.7 ms.
  browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const [map, port] of [
      ['world', WORLD_PORT],
      ['big', BIG_PORT],
    ]) {
      const page = await openGame(browser, { port, viewport: VIEWPORT, errors, name: `${map}: ` });
      await standStill(page);
      await page.waitForTimeout(500);
      const paintedBefore = (await page.evaluate(() => window.__novaland.minimap())).chunksPainted;
      await startMeasuring(page);
      for (const key of ['KeyD', 'KeyA']) {
        await page.keyboard.down(key);
        await page.waitForTimeout(WALK_MILLISECONDS);
        await page.keyboard.up(key);
      }
      const measured = await stopMeasuring(page);
      measured.chunksPaintedWhileMeasured = measured.chunksPainted - paintedBefore;
      report.rounds.push({ round, map, ...measured });
      console.log(`round ${round + 1} ${map.padEnd(5)}  frame ${measured.frameMs.median.toFixed(3)} ms median, ${measured.frameMs.mean.toFixed(3)} mean, ${measured.frameMs.p95.toFixed(3)} p95 over ${measured.frames} frames; minimap ${(measured.minimapMsPerFrame * 1000).toFixed(1)} µs a frame; ${measured.chunksDrawn} chunks kept of ${measured.chunksInMap}, ${measured.chunksPaintedWhileMeasured} painted during the walk`);
      if (round === ROUNDS - 1) await saveProofPictures(page, `05-frame-time-${map}`);
      await page.context().close();
    }
  }
  const of = (map, read) => report.rounds.filter((round) => round.map === map).map(read);
  const worldFrames = of('world', (round) => round.frameMs.median);
  const bigFrames = of('big', (round) => round.frameMs.median);
  const noise = Math.max(...worldFrames) - Math.min(...worldFrames);
  const allowance = Math.max(noise, 0.05 * median(worldFrames));
  const difference = median(bigFrames) - median(worldFrames);
  report.summary = { worldFrameMs: median(worldFrames), bigFrameMs: median(bigFrames), difference, noise, allowance, worldMinimapMs: median(of('world', (round) => round.minimapMsPerFrame)), bigMinimapMs: median(of('big', (round) => round.minimapMsPerFrame)) };
  results.push(check('the big map has over a hundred chunks and the minimap keeps a handful of them', of('big', (round) => round.chunksInMap).every((chunks) => chunks > 100) && of('big', (round) => round.chunksDrawn).every((chunks) => chunks <= 25), `${of('big', (round) => round.chunksInMap)[0]} chunks against the world's ${of('world', (round) => round.chunksInMap)[0]}; kept ${of('big', (round) => round.chunksDrawn).join(', ')}`));
  results.push(check('the measured walk on the big map includes painting new chunks, which the world never needs', of('big', (round) => round.chunksPaintedWhileMeasured).every((painted) => painted > 0) && of('world', (round) => round.chunksPaintedWhileMeasured).every((painted) => painted === 0), `painted during the walk: big ${of('big', (round) => round.chunksPaintedWhileMeasured).join(', ')}; world ${of('world', (round) => round.chunksPaintedWhileMeasured).join(', ')}`));
  results.push(check('frame time on the 400x300 map is within noise of the world\'s', difference <= allowance, `world ${median(worldFrames).toFixed(3)} ms (rounds ${worldFrames.map((ms) => ms.toFixed(3)).join(', ')}); big ${median(bigFrames).toFixed(3)} ms (rounds ${bigFrames.map((ms) => ms.toFixed(3)).join(', ')}); difference ${difference.toFixed(3)} ms, allowed ${allowance.toFixed(3)} ms`));
  const worldSlow = of('world', (round) => round.frameMs.p95);
  const bigSlow = of('big', (round) => round.frameMs.p95);
  const slowAllowance = Math.max(Math.max(...worldSlow) - Math.min(...worldSlow), 0.05 * median(worldSlow));
  report.summary.worldP95Ms = median(worldSlow);
  report.summary.bigP95Ms = median(bigSlow);
  results.push(check('and so are its slow frames (the 95th percentile)', median(bigSlow) - median(worldSlow) <= slowAllowance, `world ${median(worldSlow).toFixed(3)} ms (rounds ${worldSlow.map((ms) => ms.toFixed(3)).join(', ')}); big ${median(bigSlow).toFixed(3)} ms (rounds ${bigSlow.map((ms) => ms.toFixed(3)).join(', ')}); allowed ${slowAllowance.toFixed(3)} ms more`));
  results.push(check('the minimap\'s own share of a frame is under a twentieth of a millisecond on both maps', report.summary.worldMinimapMs < 0.05 && report.summary.bigMinimapMs < 0.05, `world ${(report.summary.worldMinimapMs * 1000).toFixed(1)} µs a frame, big ${(report.summary.bigMinimapMs * 1000).toFixed(1)} µs a frame`));
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('05-frame-time.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Starts collecting the gap between frames and the time spent in the minimap's per-frame call. */
function startMeasuring(page) {
  return page.evaluate(() => {
    const minimap = window.__novaland.game.scene.getScene('hud').minimap;
    const measuring = { gaps: [], minimapMs: 0, minimapCalls: 0, last: undefined, running: true };
    const show = minimap.show.bind(minimap);
    minimap.show = (options) => {
      const before = performance.now();
      show(options);
      measuring.minimapMs += performance.now() - before;
      measuring.minimapCalls += 1;
    };
    const onFrame = (now) => {
      if (!measuring.running) return;
      if (measuring.last !== undefined) measuring.gaps.push(now - measuring.last);
      measuring.last = now;
      window.requestAnimationFrame(onFrame);
    };
    window.requestAnimationFrame(onFrame);
    window.measuring = measuring;
  });
}

function stopMeasuring(page) {
  return page.evaluate(() => {
    const { measuring } = window;
    measuring.running = false;
    const gaps = [...measuring.gaps].sort((first, second) => first - second);
    const report = window.__novaland.minimap();
    return {
      frames: gaps.length,
      frameMs: { median: gaps[Math.floor(gaps.length / 2)], mean: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length, p95: gaps[Math.floor(gaps.length * 0.95)] },
      minimapMsPerFrame: measuring.minimapMs / measuring.minimapCalls,
      chunksDrawn: report.chunksDrawn.length,
      chunksInMap: report.chunksInMap,
      chunksPainted: report.chunksPainted,
    };
  });
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}
