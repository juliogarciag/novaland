/**
 * V2: the procedure against this repository with the real gh, as a snapshot.
 * It never removes anything. Assertions that depend on worktrees that may
 * no longer exist are reported as SKIP rather than FAIL.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { HERE, REPO, summarize, writeProof } from './lib.mjs';
import { classify, discoverTrackers, findRoot, listWorktrees, preview } from './procedure.mjs';

const results = [];
const output = [];
const log = (line = '') => {
  output.push(line);
  console.log(line);
};
const check = (name, pass, details) => {
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}${details ? `  (${details})` : ''}`);
  results.push({ name, pass, details });
};
const now = Math.floor(Date.now() / 1000);
const root = findRoot(HERE, process.env);
const before = listWorktrees(root, process.env).map((w) => w.path);
check('ROOT is the first entry of git worktree list', realpathSync(before[0]) === root, root);
const entries = classify({ root, cwd: HERE, now, ageDays: 7, env: process.env });
for (const line of preview(entries, 7)) log(line);
const self = entries.find((e) => path.resolve(root, '.worktrees', e.slug) === realpathSync(REPO));
if (self) check('the worktree this runs from is kept as current session', self.reason === 'current session');
else log('SKIP  not running from a worktree under .worktrees/');
const bootstrap = entries.find((e) => e.slug === '1-bootstrap-monorepo');
if (bootstrap) {
  const removable = bootstrap.verdict === 'REMOVE' && /PR merged \(#3\), ticket closed \(#1\)/.test(bootstrap.reason);
  const busy = bootstrap.reason.startsWith('running process');
  check('the merged bootstrap worktree is removable, or kept only because a process runs in it', removable || busy, bootstrap.reason);
  const trackers = discoverTrackers({ root, branch: '1-bootstrap-monorepo', headSha: bootstrap.head, env: process.env });
  const pr = trackers.list?.find((t) => t.kind === 'PR' && t.number === 3);
  const ticket = trackers.list?.find((t) => t.kind === 'ticket' && t.number === 1);
  check('the real gh reports PR #3 merged with the worktree head in it and ticket #1 closed', pr?.state === 'MERGED' && pr.terminal === true && ticket?.state === 'CLOSED', trackers.error ?? `${pr?.state} ${ticket?.state}`);
} else log('SKIP  1-bootstrap-monorepo no longer exists');
const after = listWorktrees(root, process.env).map((w) => w.path);
check('the worktree list is unchanged by a preview', JSON.stringify(after) === JSON.stringify(before), `${after.length} worktrees`);
const ok = summarize(results);
output.push('', ok ? `ALL ${results.length} CHECKS PASSED` : 'SOME CHECKS FAILED');
writeProof('02-live.txt', `# ${new Date().toISOString()}\n` + output.join('\n').replace(/pid \d+/g, 'pid N') + '\n', { [root]: '<repo>' });
process.exit(ok ? 0 : 1);
