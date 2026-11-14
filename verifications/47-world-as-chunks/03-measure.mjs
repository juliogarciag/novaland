/**
 * V3: terrain no longer costs per send. Runs measure.mts (five players
 * walking on a generated 40x30 and a generated 400x300 map, on the new code)
 * and compares it with baseline/measurements.json, the same measurement on
 * the code before this ticket and the ticket's own table.
 *
 * What must hold: world-state entities are the same on both maps, and the
 * full state a joiner gets and the delta per send are the same size to
 * within the digits of five positions (they depend on the five players, not
 * on the ground); the per-send cost on the big map is no worse than on
 * the small one beyond noise; and the big map boots at the default entity
 * capacity, which it could not before.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const HERE = import.meta.dirname;
const results = [];
const baseline = JSON.parse(readFileSync(path.join(HERE, 'baseline/measurements.json'), 'utf8'));
const { code, output } = await run('pnpm', ['exec', 'tsx', path.join(HERE, 'measure.mts')], { cwd: path.join(ROOT, 'packages/server') });
const lastLine = output.trim().split('\n').at(-1) ?? '';
let measured;
try {
  measured = JSON.parse(lastLine);
} catch {
  measured = undefined;
}
results.push(check('the measurement ran', code === 0 && Array.isArray(measured), code === 0 ? undefined : output.slice(-400)));
if (Array.isArray(measured)) {
  const [small, big] = measured;
  const [smallBefore, bigBefore] = baseline;
  const table = [
    ['', '40x30 before', '40x30 now', '400x300 before', '400x300 now'],
    ['entities in the sim', smallBefore.simEntities, small.simEntities, bigBefore.simEntities, big.simEntities],
    ['entities in world state', smallBefore.worldStateEntities, small.worldStateEntities, bigBefore.worldStateEntities, big.worldStateEntities],
    ['build + diff world state, ms per send', smallBefore.perSendMs, small.perSendMs, bigBefore.perSendMs, big.perSendMs],
    ['delta, bytes per send', smallBefore.deltaBytesPerSend, small.deltaBytesPerSend, bigBefore.deltaBytesPerSend, big.deltaBytesPerSend],
    ['full state on join or resync, bytes', smallBefore.fullStateBytes, small.fullStateBytes, bigBefore.fullStateBytes, big.fullStateBytes],
    ['snapshot + hash, ms', smallBefore.snapshotAndHashMs, small.snapshotAndHashMs, bigBefore.snapshotAndHashMs, big.snapshotAndHashMs],
  ];
  const text = table.map((row) => row.map((cell, index) => String(cell).padEnd(index === 0 ? 40 : 16)).join('')).join('\n');
  console.log(`\n${text}\n`);

  results.push(check('both maps are the ground the baseline was measured on', small.sameGroundAsBaseline && big.sameGroundAsBaseline));
  results.push(check('the 400x300 map boots at the default capacity (before: 3,314 entities, over the default 1,024)', big.capacity === small.capacity && big.capacity === 1024, `capacity ${big.capacity}, ${big.chunks} chunks`));
  results.push(check('world-state entities do not grow with the map: the five players on both', small.worldStateEntities === 5 && big.worldStateEntities === 5, `${small.worldStateEntities} and ${big.worldStateEntities}; before ${smallBefore.worldStateEntities} and ${bigBefore.worldStateEntities}`));
  results.push(check('the sim holds no entity for terrain on either map', small.simEntities === 5 && big.simEntities === 5, `${small.simEntities} and ${big.simEntities}`));
  results.push(check('a prediction of either map holds no entity until it adopts one', small.predictionEntitiesBeforeAdopting === 0 && big.predictionEntitiesBeforeAdopting === 0));
  // Five players as JSON: the digits differ with where they stand, so the sizes are close, not equal.
  results.push(check('the full state a joiner gets is the five players, on both maps', Math.abs(small.fullStateBytes - big.fullStateBytes) < 60 && big.fullStateBytes < 2000, `${small.fullStateBytes} and ${big.fullStateBytes} bytes; before ${smallBefore.fullStateBytes} and ${bigBefore.fullStateBytes}`));
  results.push(check('the delta per send is the players moving, on both maps', Math.abs(small.deltaBytesPerSend - big.deltaBytesPerSend) < 60, `${small.deltaBytesPerSend} and ${big.deltaBytesPerSend} bytes`));
  // Timings of a few hundredths of a millisecond are noisy: allow the big map twice the small one plus 0.05 ms.
  results.push(check('the per-send cost does not grow with the map', big.perSendMs <= small.perSendMs * 2 + 0.05, `${small.perSendMs} ms and ${big.perSendMs} ms; before ${smallBefore.perSendMs} ms and ${bigBefore.perSendMs} ms`));
  results.push(check('the per-send cost on the big map is at least 20 times lower than before', big.perSendMs * 20 <= bigBefore.perSendMs, `${bigBefore.perSendMs} ms before, ${big.perSendMs} ms now`));
  writeProof('03-measure.json', { before: baseline, now: measured, table: text.split('\n'), results });
}
process.exit(summarize(results) ? 0 : 1);
