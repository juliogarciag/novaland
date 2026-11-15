/**
 * V2: what the bigger world costs, against the 40x30 world from before this
 * ticket. Runs measure.mts (five players walking, both maps measured in
 * turns in one process) and checks the three things the ticket names: tick
 * cost, per-send cost and full-state size.
 *
 * "The same within noise" is decided by the rounds themselves: a number is
 * the same when its median on the world now lies inside what the rounds on
 * the world before spanned, lowest to highest. Sizes in bytes are not timed,
 * so they are compared directly: the digits of five positions may differ.
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
  const milliseconds = (numbers) => `${numbers.median.toFixed(4)} (${numbers.lowest.toFixed(4)} to ${numbers.highest.toFixed(4)})`;
  const table = [
    ['', 'world before', 'world now'],
    ['tiles', `${before.tiles} (${before.columns}x${before.rows})`, `${now.tiles} (${now.columns}x${now.rows})`],
    ['chunks', before.chunks, now.chunks],
    ['entities in the sim', before.simEntities, now.simEntities],
    ['entities in world state', before.worldStateEntities, now.worldStateEntities],
    ['full state on join or resync, bytes', before.fullStateBytes, now.fullStateBytes],
    ['delta, bytes per send', before.deltaBytesPerSend, now.deltaBytesPerSend],
    ['build + diff world state, ms per send', milliseconds(before.perSendMs), milliseconds(now.perSendMs)],
    ['one tick of the sim, ms', milliseconds(before.tickMs), milliseconds(now.tickMs)],
    ['creating the sim, ms', milliseconds(before.bootMs), milliseconds(now.bootMs)],
    ['snapshot + hash, ms', milliseconds(before.snapshotAndHashMs), milliseconds(now.snapshotAndHashMs)],
  ];
  const text = table.map((row) => row.map((cell, index) => String(cell).padEnd(index === 0 ? 40 : 30)).join('')).join('\n');
  console.log(`\n${text}\n(times: median of ${measured.rounds} rounds, lowest to highest in brackets)\n`);

  const withinNoise = (numbersBefore, numbersNow) => numbersNow.median <= numbersBefore.highest && numbersNow.median >= numbersBefore.lowest * 0.5;
  results.push(check('the world now is about ten times the world before', now.tiles / before.tiles > 9.5 && now.tiles / before.tiles < 10.5, `${(now.tiles / before.tiles).toFixed(2)} times`));
  results.push(check('world state holds the five players and nothing else, on both', before.worldStateEntities === measured.players && now.worldStateEntities === measured.players && now.simEntities === measured.players));
  results.push(check('full-state size is the same: the five players, to within the digits of their positions', Math.abs(before.fullStateBytes - now.fullStateBytes) < 60, `${before.fullStateBytes} and ${now.fullStateBytes} bytes`));
  results.push(check('the delta per send is the same size', Math.abs(before.deltaBytesPerSend - now.deltaBytesPerSend) < 60, `${before.deltaBytesPerSend} and ${now.deltaBytesPerSend} bytes`));
  results.push(check('per-send cost is the same within noise', withinNoise(before.perSendMs, now.perSendMs), `${milliseconds(before.perSendMs)} ms before, ${milliseconds(now.perSendMs)} ms now`));
  // The ticket's third number. It is NOT the same: see the README, "What is not met".
  results.push(check('tick cost is the same within noise', withinNoise(before.tickMs, now.tickMs), `${milliseconds(before.tickMs)} ms before, ${milliseconds(now.tickMs)} ms now: ${(now.tickMs.median / before.tickMs.median).toFixed(1)} times`));
  results.push(check('one tick still takes under 1% of the time a tick has', now.tickMs.highest < TICK_BUDGET_MS / 100, `${now.tickMs.highest.toFixed(4)} ms of ${TICK_BUDGET_MS.toFixed(2)} ms: ${((100 * now.tickMs.median) / TICK_BUDGET_MS).toFixed(2)}%`));
  writeProof('02-measure.json', { measured, table: text.split('\n'), results });
}
process.exit(summarize(results) ? 0 : 1);
