/**
 * V1: the "done when" commands pass, the tests this ticket adds ran and
 * passed, the sim's rules did not change (rocks solid, grass walkable, same
 * def ids) and the sim is still deterministic. The state hash of the
 * headless run is recorded: it differs from the one before the ticket
 * because the level's colliders changed (two tree tiles closed the old path
 * mouth in row 2).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, summarize, writeProof } from './lib.mjs';

/** What `pnpm sim:headless` printed before this ticket (verifications/36-tree-art/01-check.mjs pins it). */
const STATE_HASH_BEFORE_THE_TICKET = '50b21d74';

const results = [];
let log = '';
const steps = [
  ['install', ['install', '--frozen-lockfile']],
  ['test', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${path.join(PROOF, '01-tests.json')}`]],
  ['typecheck', ['typecheck']],
  ['lint', ['lint']],
];
for (const [name, args] of steps) {
  const { code, output } = run('pnpm', args);
  log += `\n$ pnpm ${args.join(' ')}\n${output}\n(exit ${code})\n`;
  results.push(check(`pnpm ${name} exits 0`, code === 0, `exit ${code}`));
}

const report = JSON.parse(readFileSync(path.join(PROOF, '01-tests.json'), 'utf8'));
const tests = report.testResults.flatMap((file) => file.assertionResults.map((test) => ({ name: test.fullName, status: test.status })));
const passedNamed = (pattern) => tests.filter((test) => pattern.test(test.name) && test.status === 'passed').length;
const expectPassed = (label, pattern, count) => results.push(check(label, passedNamed(pattern) === count, `${passedNamed(pattern)} of ${count} tests`));
results.push(check('all tests passed, none skipped', report.numFailedTests === 0 && report.numPendingTests === 0 && report.numPassedTests === report.numTotalTests, `${report.numPassedTests}/${report.numTotalTests}`));
expectPassed('sim: the starter level has no paths, is ringed by trees and spawns on reachable grass', /^the starter level /, 3);
expectPassed('sim: a rock is still solid, grass still walkable, ids unchanged', /tile defs a rock is still one solid tile and grass still walkable ground/, 1);
expectPassed('sim: ground sprites are well formed', /tile defs a ground sprite has at least one variant/, 1);
expectPassed('sim: tile sprite keys are unique', /tile defs no tile sprite shares its key/, 1);
expectPassed('client: the ground tileset gives each def its tiles', /^groundTilesetSlots /, 4);
expectPassed('client: the ground shows the variant a tile picks, also under trees and rocks, and falls back flat', /^groundTileIndexRows /, 6);
expectPassed('client: variant picking is repeatable and spread out', /^variantOfTile /, 4);
expectPassed('client: rocks are placed as standing tiles', /^standingTilePlacements /, 5);
expectPassed('client: the rock generator paints what the rock def declares, a buried rock in every frame', /^rock sheet generator /, 5);
expectPassed('client: the grass generator paints what the grass def declares, textured all over', /^grass sheet generator /, 4);
expectPassed('client: the tree generator still paints what the tree def declares', /^tree sheet generator /, 2);
expectPassed('determinism test still passes', /determinism same seed \+ same commands = identical state/, 1);

const hashes = [];
for (let attempt = 0; attempt < 2; attempt += 1) {
  const headless = run('pnpm', ['sim:headless']);
  log += `\n$ pnpm sim:headless\n${headless.output}\n(exit ${headless.code})\n`;
  hashes.push(headless.code === 0 ? /"hash":"([0-9a-f]+)"/.exec(headless.output)?.[1] : undefined);
}
results.push(check('two headless runs end on the same state hash', hashes[0] !== undefined && hashes[0] === hashes[1], hashes.join(', ')));
results.push(check(`that hash differs from the one before the ticket (${STATE_HASH_BEFORE_THE_TICKET}): the level's colliders changed`, hashes[0] !== STATE_HASH_BEFORE_THE_TICKET, `now ${hashes[0]}`));

writeProof('01-check-output.txt', log);
writeProof('01-tests.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Runs a command to completion. Never throws; returns { code, output }. */
function run(command, args) {
  const child = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: child.status, output: `${child.stdout ?? ''}${child.stderr ?? ''}` };
}
