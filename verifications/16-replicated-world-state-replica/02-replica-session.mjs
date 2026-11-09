/**
 * V2: a five-player session over a simulated wire (session.ts), run with the
 * server package's tsx against the sim's public API: full state on join,
 * deltas at the default send rate, a replica that matches the sim at every
 * send, a resync after a dropped message, hostile messages that never throw.
 */
import { ROOT, check, run, summarize, writeProof } from './lib.mjs';

const results = [];
const { code, stdout, stderr } = await run('pnpm', ['--filter', '@novaland/server', 'exec', 'tsx', '../../verifications/16-replicated-world-state-replica/session.ts'], { cwd: ROOT });
const line = stdout.split('\n').find((l) => l.startsWith('{'));
const report = line ? JSON.parse(line) : null;
results.push(check('the session script exits 0 and prints a report', code === 0 && report !== null, code === 0 ? '' : stderr.slice(-400)));
if (report) {
  results.push(check(`five players joined (one left and came back) over ${report.ticks} ticks at ${report.tickRate} Hz`, report.seats === 5 && report.joins === 6 && report.leaves === 1 && report.playersAtEnd === 5, `${report.joins} joins, ${report.leaves} leave, ${report.playersAtEnd} players at the end`));
  results.push(check('the welcome message named a level findLevel resolves and carried a full state the replica applied', report.welcomeResult === 'applied', `${report.welcomeBytes} bytes`));
  results.push(check(`deltas went out at ${report.sendRate} per second (${report.sends} sends)`, report.sends === (report.ticks * report.sendRate) / report.tickRate));
  results.push(check('the replica matched the sim at every send: renderables, world state, player entities, headings', report.mismatches === 0, report.firstMismatch ? JSON.stringify(report.firstMismatch).slice(0, 300) : 'no mismatch'));
  results.push(check('a delta with five moving players is a few hundred bytes; the full state is far bigger', report.deltaBytes.mean < 500 && report.deltaBytes.max < 1200 && report.fullStateBytes > 10 * report.deltaBytes.mean, `delta min/mean/max ${report.deltaBytes.min}/${report.deltaBytes.mean}/${report.deltaBytes.max} bytes, full state ${report.fullStateBytes} bytes for ${report.entitiesInFullState} entities`));
  results.push(check('a dropped delta is reported as out-of-sequence and leaves the replica byte-for-byte untouched', report.resync.outOfSequence === 'out-of-sequence' && report.resync.untouchedAfterOutOfSequence === true));
  results.push(check('a full state (world/resync) brings the replica back in step', report.resync.resynced === 'applied' && report.resync.sameAfterResync === true));
  results.push(check(`${report.hostile.messages} hostile messages never threw, and the view queries kept working`, report.hostile.throws === 0 && report.hostile.results.every((result) => ['applied', 'out-of-sequence', 'malformed'].includes(result)), report.hostile.results.join(', ')));
  results.push(check('the replica recovered from hostile input with one full state', report.hostile.recoveredAfterHostile === true));
  results.push(check('replica.step() throws; its snapshot has no physics and no rng', report.stepThrew === true && report.replicaSnapshot.physics === '' && report.replicaSnapshot.rng === 0));
}
writeProof('02-replica-session.json', report ?? { code, stdout, stderr });
process.exit(summarize(results) ? 0 : 1);
