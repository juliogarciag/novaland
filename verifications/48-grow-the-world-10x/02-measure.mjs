/**
 * V2: what the bigger world costs, against the 40x30 world from before this
 * ticket. Runs measure.mts (five players walking, both maps measured in
 * turns in one process) and checks the three things the ticket names: tick
 * cost, per-send cost and full-state size.
 *
 * "The same within noise" is a time whose median over the rounds, on the
 * world now, is within a quarter of its median on the world before: rounds
 * of the same map differ by about a tenth between runs of this script.
 * Sizes in bytes are not timed, so they are compared directly: the digits
 * of five positions may differ.
 */
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const HERE = import.meta.dirname;
/** One tick at the sim's rate of 60 a second. */
const TICK_BUDGET_MS = 1000 / 60;
const results = [];
const { code, output } = await run('pnpm', ['exec', 'tsx', path.join(HERE, 'measure.mts')], { cwd: path.join(ROOT, 'packages/server') });
let measured;
try {
  measured = JSON.parse(output.trim().split('\n').at(-1) ?? '');
} catch {
  measured = undefined;
}
results.push(check('the measurement ran', code === 0 && measured !== undefined, code === 0 ? undefined : output.slice(-400)));
if (measured) {
  const { before, now } = measured;
  const roundsOf = (numbers) => `${numbers.median.toFixed(4)} (${numbers.lowest.toFixed(4)} to ${numbers.highest.toFixed(4)})`;
  const table = [
    ['', 'world before', 'world now'],
    ['tiles', `${before.tiles} (${before.columns}x${before.rows})`, `${now.tiles} (${now.columns}x${now.rows})`],
    ['chunks', before.chunks, now.chunks],
    ['entities in the sim', before.simEntities, now.simEntities],
    ['entities in world state', before.worldStateEntities, now.worldStateEntities],
    ['full state on join or resync, bytes', before.fullStateBytes, now.fullStateBytes],
    ['delta, bytes per send', before.deltaBytesPerSend, now.deltaBytesPerSend],
    ['build + diff world state, ms per send', roundsOf(before.perSendMs), roundsOf(now.perSendMs)],
    ['one tick of the sim, ms', roundsOf(before.tickMs), roundsOf(now.tickMs)],
    ['one tick with nobody in the world, ms', roundsOf(before.emptyTickMs), roundsOf(now.emptyTickMs)],
    ['physics world in a snapshot, bytes', before.physicsBytes, now.physicsBytes],
    ['creating the sim, ms', roundsOf(before.bootMs), roundsOf(now.bootMs)],
    ['snapshot + hash, ms', roundsOf(before.snapshotAndHashMs), roundsOf(now.snapshotAndHashMs)],
  ];
  const text = table.map((row) => row.map((cell, index) => String(cell).padEnd(index === 0 ? 40 : 30)).join('')).join('\n');
  console.log(`\n${text}\n(times: median of ${measured.rounds} rounds, lowest to highest in brackets)\n`);

  const timesBefore = (numbersBefore, numbersNow) => numbersNow.median / numbersBefore.median;
  const isWithinNoise = (numbersBefore, numbersNow) => timesBefore(numbersBefore, numbersNow) < 1.25 && timesBefore(numbersBefore, numbersNow) > 0.8;
  results.push(check('the world now is about ten times the world before', now.tiles / before.tiles > 9.5 && now.tiles / before.tiles < 10.5, `${(now.tiles / before.tiles).toFixed(2)} times`));
  results.push(check('world state holds the five players and nothing else, on both', before.worldStateEntities === measured.players && now.worldStateEntities === measured.players && now.simEntities === measured.players));
  results.push(check('full-state size is the same: the five players, to within the digits of their positions', Math.abs(before.fullStateBytes - now.fullStateBytes) < 60, `${before.fullStateBytes} and ${now.fullStateBytes} bytes`));
  results.push(check('the delta per send is the same size', Math.abs(before.deltaBytesPerSend - now.deltaBytesPerSend) < 60, `${before.deltaBytesPerSend} and ${now.deltaBytesPerSend} bytes`));
  results.push(check('per-send cost is the same within noise', isWithinNoise(before.perSendMs, now.perSendMs), `${roundsOf(before.perSendMs)} ms before, ${roundsOf(now.perSendMs)} ms now: ${timesBefore(before.perSendMs, now.perSendMs).toFixed(2)} times`));
  // The ticket's third number. It is NOT the same: see the README, "What is not met".
  results.push(check('tick cost is the same within noise', isWithinNoise(before.tickMs, now.tickMs), `${roundsOf(before.tickMs)} ms before, ${roundsOf(now.tickMs)} ms now: ${timesBefore(before.tickMs, now.tickMs).toFixed(1)} times`));
  // Why: the step costs time for the terrain itself. With nobody in the world the difference is the same.
  results.push(check('the extra tick cost is there with nobody in the world: it is the terrain in the physics step, not the players', now.emptyTickMs.median - before.emptyTickMs.median > 0.5 * (now.tickMs.median - before.tickMs.median), `${roundsOf(before.emptyTickMs)} ms before, ${roundsOf(now.emptyTickMs)} ms now; the physics world is ${(now.physicsBytes / before.physicsBytes).toFixed(1)} times the bytes`));
  results.push(check('one tick still takes under 1% of the time a tick has', now.tickMs.highest < TICK_BUDGET_MS / 100, `the slowest round ${now.tickMs.highest.toFixed(4)} ms of ${TICK_BUDGET_MS.toFixed(2)} ms: ${((100 * now.tickMs.highest) / TICK_BUDGET_MS).toFixed(2)}%; the median ${((100 * now.tickMs.median) / TICK_BUDGET_MS).toFixed(2)}%`));
  writeProof('02-measure.json', { measured, table: text.split('\n'), results });
}
process.exit(summarize(results) ? 0 : 1);
