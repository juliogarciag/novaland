/**
 * V2: the procedure against this repository with the real gh, as a snapshot.
 * It never removes anything. Assertions that depend on worktrees that may
 * no longer exist are reported as SKIP rather than FAIL.
 */
import path from 'node:path';
import { HERE, REPO, check, summarize, writeProof } from './lib.mjs';
import { classify, findRoot, listWorktrees, preview } from './procedure.mjs';

const results = [];
const output = [];
const log = (line = '') => {
  output.push(line);
  console.log(line);
};
const now = Math.floor(Date.now() / 1000);
const cwd = HERE;
const root = findRoot(cwd, process.env);
results.push(check('ROOT is the first entry of git worktree list', listWorktrees(root, process.env)[0]?.path === root, root));
const entries = classify({ root, cwd, now, ageDays: 7, env: process.env });
for (const line of preview(entries, 7)) log(line);
const self = entries.find((e) => path.resolve(root, '.worktrees', e.slug) === path.resolve(REPO));
if (self) results.push(check('the worktree this runs from is kept as current session', self.reason === 'current session'));
else log('SKIP  not running from a worktree under .worktrees/');
const bootstrap = entries.find((e) => e.slug === '1-bootstrap-monorepo');
if (bootstrap) {
  const removable = bootstrap.verdict === 'REMOVE' && /PR merged \(#3\), ticket closed \(#1\)/.test(bootstrap.reason);
  const busy = bootstrap.reason.startsWith('running process');
  results.push(check('the merged bootstrap worktree is removable, or kept only for a running process', removable || busy, bootstrap.reason));
}
else log('SKIP  1-bootstrap-monorepo no longer exists');
results.push(check('no worktree was removed', listWorktrees(root, process.env).length === entries.length + 1));
const ok = summarize(results);
output.push('', ok ? `ALL ${results.length} CHECKS PASSED` : 'SOME CHECKS FAILED');
writeProof('02-live.txt', `# ${new Date().toISOString()}\n` + output.join('\n') + '\n', { [root]: '<repo>' });
process.exit(ok ? 0 : 1);
