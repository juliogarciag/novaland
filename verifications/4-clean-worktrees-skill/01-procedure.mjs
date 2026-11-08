// Dry-runs the clean-worktrees skill's procedure against this repository.
// Nothing is removed. Exit code 1 if any check fails.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const AGE_DAYS = 7;
const cutoff = Date.now() / 1000 - AGE_DAYS * 86400;
const results = [];
const lines = [];
const say = (line) => { lines.push(line); console.log(line); };
const check = (name, ok, detail = '') => { results.push(ok); say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gh = (args, cwd) => JSON.parse(execFileSync('gh', args, { cwd, encoding: 'utf8' }));

// Step 2: ROOT, even when run from inside a worktree.
const top = git(['rev-parse', '--show-toplevel'], process.cwd());
const ROOT = top.includes('/.worktrees/') ? top.slice(0, top.indexOf('/.worktrees/')) : top;
check('resolves ROOT to the main checkout', !ROOT.includes('.worktrees'), ROOT);

// Step 3: parse the porcelain list.
const blocks = git(['worktree', 'list', '--porcelain'], ROOT).split('\n\n').filter(Boolean);
const worktrees = blocks.map((block) => {
  const entry = { locked: false, bare: false };
  for (const line of block.split('\n')) {
    if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
    else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true;
    else if (line === 'bare') entry.bare = true;
  }
  return entry;
});
check('lists the main worktree and at least one under .worktrees/', worktrees.some((w) => w.path === ROOT) && worktrees.some((w) => w.path.includes('/.worktrees/')), `${worktrees.length} worktrees`);

const cwd = process.cwd();
const candidates = worktrees
  .filter((w) => w.path !== ROOT && !w.locked && !w.bare)
  .map((w) => {
    const slug = path.basename(w.path);
    const isCurrent = cwd === w.path || cwd.startsWith(w.path + path.sep);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], w.path);
    const lastCommitTs = Number(git(['log', '-1', '--format=%ct', 'HEAD'], w.path));
    return { ...w, slug, isCurrent, branch, lastCommitTs };
  });

// Step 4: trackers.
const classified = candidates.map((w) => {
  if (w.isCurrent) return { ...w, verdict: 'keep', reason: 'current session' };
  if (w.branch === 'HEAD') return { ...w, verdict: 'keep', reason: 'detached' };
  const trackers = [];
  const prs = gh(['pr', 'list', '--head', w.branch, '--state', 'all', '--json', 'number,state', '--limit', '1'], ROOT);
  if (prs.length > 0) trackers.push({ kind: 'PR', id: prs[0].number, state: prs[0].state, terminal: prs[0].state === 'MERGED' || prs[0].state === 'CLOSED' });
  const ticketMatch = /^(\d+)-/.exec(w.branch);
  if (ticketMatch) {
    try {
      const issue = gh(['issue', 'view', ticketMatch[1], '--json', 'state'], ROOT);
      trackers.push({ kind: 'ticket', id: Number(ticketMatch[1]), state: issue.state, terminal: issue.state === 'CLOSED' });
    } catch {
      /* no ticket */
    }
  }
  const describe = (t) => `${t.kind} ${t.state.toLowerCase()} (#${t.id})`;
  if (trackers.length === 0) {
    const days = Math.floor((Date.now() / 1000 - w.lastCommitTs) / 86400);
    const unused = w.lastCommitTs < cutoff;
    return { ...w, verdict: unused ? 'REMOVE' : 'keep', reason: `no trackers, last commit ${days}d ago${unused ? '' : ` (< ${AGE_DAYS}d)`}` };
  }
  const allTerminal = trackers.every((t) => t.terminal);
  return { ...w, verdict: allTerminal ? 'REMOVE' : 'keep', reason: trackers.map(describe).join(', ') };
});

// Step 6: preview.
say('');
for (const w of classified) say(`${w.verdict.padEnd(6)}  .worktrees/${w.slug}  branch=${w.branch}  — ${w.verdict === 'REMOVE' ? 'unused: ' : 'keep: '}${w.reason}`);
const removeCount = classified.filter((w) => w.verdict === 'REMOVE').length;
say(`${removeCount} to remove, ${classified.length - removeCount} to keep`);
say('');

const bootstrap = classified.find((w) => w.slug === '1-bootstrap-monorepo');
check('the merged bootstrap worktree is REMOVE', bootstrap?.verdict === 'REMOVE', bootstrap?.reason ?? 'not present');
check('its reason names the merged PR and the closed ticket', /PR merged \(#3\)/.test(bootstrap?.reason ?? '') && /ticket closed \(#1\)/.test(bootstrap?.reason ?? ''));
const self = classified.find((w) => w.slug === '4-clean-worktrees-skill');
check("the open ticket's worktree is keep", self?.verdict === 'keep', self?.reason ?? 'not present');
check('nothing was removed', git(['worktree', 'list', '--porcelain'], ROOT).split('\n\n').filter(Boolean).length === worktrees.length);

const failed = results.filter((ok) => !ok).length;
say(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} OF ${results.length} CHECKS FAILED`);
writeFileSync(path.join(ROOT, '.worktrees', '4-clean-worktrees-skill', 'verifications', '4-clean-worktrees-skill', 'proof', '01-procedure.txt'), lines.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
