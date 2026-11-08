/**
 * Reference implementation of .claude/skills/clean-worktrees/SKILL.md, step
 * for step, so the verification can table-test every branch of the rule.
 * The skill text is what agents follow; this file mirrors it. 01-fixture.mjs
 * checks that the commands, patterns, defaults and keep-reason order here are
 * the ones SKILL.md states.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_AGE_DAYS = 7;
export const AGE_ARGUMENT_PATTERN = /^[1-9][0-9]{0,3}$/;
export const SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;
export const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
export const NOT_FOUND_PATTERN = /could not resolve to an issue/i;
export const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;
export const NUMBER_PATTERN = /^[1-9][0-9]*$/;
export const ROOT_PATTERN = /^[A-Za-z0-9._/ -]+$/;
export const TICKET_PATTERN = /^([0-9]+)-/;

/** The gh commands the skill prescribes. The argv below is built from these strings. */
export const GH_COMMANDS = {
  prList: 'gh pr list --head="$branch" --state all --json number,state,isCrossRepository,headRefOid',
  issueView: 'gh issue view "$n" --json state,url',
};

/** Step 3 keep reasons in precedence order; the fixture checks SKILL.md lists them in this order. */
export const KEEP_ORDER = [
  'bare',
  'prunable (run git worktree prune)',
  'locked',
  'detached',
  'unusual name',
  'outside .worktrees/',
  'worktree and branch names differ',
  'contains another worktree',
  'default branch',
  'current session',
  'uncommitted changes',
  'running process',
];

/** Step 1. */
export function parseAgeDays(argument) {
  const text = (argument ?? '').trim();
  if (text === '') return DEFAULT_AGE_DAYS;
  return AGE_ARGUMENT_PATTERN.test(text) ? Number(text) : null;
}

/** Step 2: the real path of the main checkout. */
export function findRoot(cwd, env) {
  const root = realpathSync(path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, env)));
  if (!ROOT_PATTERN.test(root)) throw new Error(`ROOT ${JSON.stringify(root)} has characters outside ${ROOT_PATTERN.source}; stop`);
  return root;
}

/** Step 3, parsing only (`-z`: entries end with two NULs, lines with one). */
export function listWorktrees(root, env) {
  const text = git(['worktree', 'list', '--porcelain', '-z'], root, env, { trim: false });
  return text
    .split('\0\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const worktree = { path: '', head: '', branch: null, detached: false, locked: false, prunable: false, bare: false };
      for (const line of entry.split('\0')) {
        if (line.startsWith('worktree ')) worktree.path = line.slice(9);
        else if (line.startsWith('HEAD ')) worktree.head = line.slice(5);
        else if (line.startsWith('branch refs/heads/')) worktree.branch = line.slice(18);
        else if (line === 'detached') worktree.detached = true;
        else if (line === 'locked' || line.startsWith('locked ')) worktree.locked = true;
        else if (line === 'prunable' || line.startsWith('prunable ')) worktree.prunable = true;
        else if (line === 'bare') worktree.bare = true;
      }
      return worktree;
    });
}

/**
 * Step 3 for one entry: the first keep reason that applies, or null when the
 * worktree is a candidate. Shared by classify (step 3) and remove (step 8).
 */
export function keepReason({ worktree, allWorktrees, root, cwd, env }) {
  if (worktree.bare) return 'bare';
  if (worktree.prunable) return 'prunable (run git worktree prune)';
  if (worktree.locked) return 'locked';
  if (worktree.detached || worktree.branch === null) return 'detached';
  const slug = path.basename(worktree.path);
  if (!SLUG_PATTERN.test(slug) || !BRANCH_PATTERN.test(worktree.branch)) return 'unusual name';
  const realPath = safeRealpath(worktree.path);
  if (realPath !== path.join(root, '.worktrees', slug)) return 'outside .worktrees/';
  if (slug !== worktree.branch) return 'worktree and branch names differ';
  const nested = allWorktrees.find((other) => other !== worktree && safeRealpath(other.path).startsWith(realPath + path.sep));
  if (nested) return `contains another worktree (${nested.path})`;
  if (worktree.branch === 'main') return 'default branch';
  const realCwd = safeRealpath(cwd);
  if (realCwd === realPath || realCwd.startsWith(realPath + path.sep)) return 'current session';
  return checkLiveness(worktree.path, realPath, env);
}

/** Steps 3 to 5: one verdict per worktree other than the main one. */
export function classify({ root, cwd, now, ageDays, env }) {
  const allWorktrees = listWorktrees(root, env);
  const entries = [];
  for (const worktree of allWorktrees) {
    if (safeRealpath(worktree.path) === root) continue;
    const slug = path.basename(worktree.path);
    const entry = { path: worktree.path, head: worktree.head, slug, branch: worktree.branch ?? 'HEAD', verdict: 'keep', reason: '', unpushed: 0 };
    entries.push(entry);

    const reason = keepReason({ worktree, allWorktrees, root, cwd, env });
    if (reason) {
      entry.reason = reason.startsWith('running process') ? `${reason}; stop it to let this be cleaned` : reason;
      continue;
    }

    const lastCommitTs = Number(git(['log', '-1', '--format=%ct', 'HEAD'], worktree.path, env));
    const gitFileMtime = Math.floor(statSync(path.join(worktree.path, '.git')).mtimeMs / 1000);
    const ageDaysOfWorktree = Math.floor((now - Math.max(lastCommitTs, gitFileMtime)) / 86400);
    const unpushed = spawnSync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: worktree.path, env, encoding: 'utf8' });
    entry.unpushed = unpushed.status === 0 ? Number(unpushed.stdout.trim()) : 0;

    const trackers = discoverTrackers({ root, branch: worktree.branch, headSha: worktree.head, env });
    if (trackers.error) {
      entry.reason = trackers.error;
      continue;
    }
    if (trackers.list.length === 0) {
      const unused = ageDaysOfWorktree >= ageDays;
      entry.verdict = unused ? 'REMOVE' : 'keep';
      entry.reason = `no trackers, ${ageDaysOfWorktree}d old${unused ? '' : ` (< ${ageDays}d)`}`;
      continue;
    }
    const open = trackers.list.filter((t) => !t.terminal);
    const closed = trackers.list.filter((t) => t.terminal);
    if (open.length === 0) {
      entry.verdict = 'REMOVE';
      entry.reason = closed.map(describe).join(', ');
      continue;
    }
    let text = open.map(describe).join(', ');
    if (!trackers.list.some((t) => t.kind === 'PR')) text += ', no PR yet';
    else if (closed.length > 0) text += `, ${closed.map(describe).join(', ')}`;
    if (open.some((t) => t.kind === 'ticket') && closed.some((t) => t.kind === 'PR' && t.state === 'MERGED')) {
      text += '; close the ticket to let this be cleaned';
    }
    entry.reason = text;
  }
  entries.sort((a, b) => (a.verdict === b.verdict ? a.slug.localeCompare(b.slug) : a.verdict === 'REMOVE' ? -1 : 1));
  return entries;
}

function describe(tracker) {
  const base = `${tracker.kind} ${tracker.state.toLowerCase()} (#${tracker.number})`;
  return tracker.ahead ? `${base} but HEAD is not in the PR head` : base;
}

/** Step 3: uncommitted changes and running processes, also re-run in step 8. */
export function checkLiveness(worktreePath, realPath, env) {
  const status = git(['status', '--porcelain', '--untracked-files=all'], worktreePath, env);
  if (status !== '') return 'uncommitted changes';
  const lsof = spawnSync('lsof', ['-nP', '-d', 'cwd', '-Fpn'], { env, encoding: 'utf8' });
  if (lsof.error || (lsof.status !== 0 && (lsof.stdout ?? '') === '')) return 'could not check for running processes';
  let pid = null;
  for (const line of lsof.stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n')) {
      const dir = line.slice(1);
      if (dir === realPath || dir.startsWith(realPath + path.sep)) return `running process (pid ${/^[0-9]+$/.test(pid ?? '') ? pid : '?'})`;
    }
  }
  return null;
}

/** Step 4. */
export function discoverTrackers({ root, branch, headSha, env }) {
  const list = [];
  const prs = gh(GH_COMMANDS.prList, { branch }, root, env);
  if (prs.error) return { error: `could not verify PR (${prs.error})`, list };
  for (const pr of prs.data) {
    if (pr.isCrossRepository) continue;
    if (!NUMBER_PATTERN.test(String(pr.number)) || !COMMIT_PATTERN.test(String(pr.headRefOid))) return { error: 'could not verify PR (bad value)', list };
    if (pr.state !== 'OPEN' && pr.state !== 'CLOSED' && pr.state !== 'MERGED') return { error: `unknown PR state (${clean(pr.state)})`, list };
    const finished = pr.state === 'MERGED' || pr.state === 'CLOSED';
    let contained = false;
    if (finished) {
      const ancestor = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', headSha, pr.headRefOid], { env });
      if (ancestor.status !== 0 && ancestor.status !== 1) return { error: `could not verify PR (commit ${pr.headRefOid} not found locally)`, list };
      contained = ancestor.status === 0;
    }
    list.push({ kind: 'PR', number: Number(pr.number), state: pr.state, terminal: finished && contained, ahead: finished && !contained });
  }
  const ticket = TICKET_PATTERN.exec(branch);
  if (ticket) {
    const issue = gh(GH_COMMANDS.issueView, { n: ticket[1] }, root, env);
    if (issue.notFound) return { list };
    if (issue.error) return { error: `could not verify ticket (${issue.error})`, list };
    if (issue.data.state !== 'OPEN' && issue.data.state !== 'CLOSED') return { error: `unknown ticket state (${clean(issue.data.state)})`, list };
    if (!String(issue.data.url).includes('/pull/')) {
      list.push({ kind: 'ticket', number: Number(ticket[1]), state: issue.data.state, terminal: issue.data.state === 'CLOSED' });
    }
  }
  return { list };
}

/** Runs one of GH_COMMANDS with its "$var" placeholders filled, as argv (no shell). */
function gh(command, vars, cwd, env) {
  const argv = command
    .split(' ')
    .slice(1)
    .map((word) => word.replace(/"\$(\w+)"/g, (_, name) => vars[name]));
  const result = spawnSync('gh', argv, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    if (NOT_FOUND_PATTERN.test(result.stderr)) return { notFound: true };
    return { error: clean(firstLine(result.stderr)) };
  }
  try {
    return { data: JSON.parse(result.stdout) };
  } catch {
    return { error: 'output is not JSON' };
  }
}

/** Step 6. */
export function preview(entries, ageDays = DEFAULT_AGE_DAYS) {
  const removable = entries.filter((e) => e.verdict === 'REMOVE').length;
  const shown = entries.map((e) => ({ ...e, slug: display(e.slug), branch: display(e.branch) }));
  const slugWidth = Math.max(0, ...shown.map((e) => e.slug.length + 11));
  const branchWidth = Math.max(0, ...shown.map((e) => e.branch.length + 7));
  const lines = shown.map((e) => {
    const prefix = e.verdict === 'REMOVE' ? 'unused' : 'keep';
    const unpushed = e.unpushed > 0 ? `  unpushed=${e.unpushed}` : '';
    return `${e.verdict.padEnd(6)}  ${`.worktrees/${e.slug}`.padEnd(slugWidth)}  ${`branch=${e.branch}`.padEnd(branchWidth)}  — ${prefix}: ${clean(e.reason)}${unpushed}`;
  });
  lines.push(
    removable === 0
      ? `Nothing to remove (${entries.length} kept, age threshold ${ageDays}d).`
      : `${removable} to remove, ${entries.length - removable} to keep. Removal also deletes ignored files (node_modules, .env, local logs).`,
  );
  return lines;
}

/** Step 7: the one question. Returned for the caller to ask; the procedure never answers it. */
export function confirmationQuestion(plan) {
  return `Remove these ${plan.length} worktrees? ${plan.map((e) => `${display(e.slug)}${e.unpushed > 0 ? ` (unpushed=${e.unpushed})` : ''}`).join(', ')}. Ignored files in them are deleted irreversibly.`;
}

/** Steps 8 and 9. `plan` is the REMOVE entries from the preview, in order. Never forces. */
export function removeWorktrees({ root, plan, cwd, env }) {
  const lines = [];
  let removed = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of plan) {
    const allWorktrees = listWorktrees(root, env);
    const worktree = allWorktrees.find((w) => w.path === entry.path);
    let reason = worktree ? keepReason({ worktree, allWorktrees, root, cwd, env }) : 'no longer listed';
    if (!reason && worktree.head !== entry.head) reason = 'HEAD changed';
    if (reason) {
      skipped += 1;
      lines.push(`skipped: .worktrees/${display(entry.slug)}  (${clean(reason)})`);
      continue;
    }
    const result = spawnSync('git', ['-C', root, 'worktree', 'remove', '--', realpathSync(entry.path)], { env, encoding: 'utf8' });
    if (result.status !== 0) {
      failed += 1;
      lines.push(`failed: .worktrees/${display(entry.slug)}  (${clean(firstLine(result.stderr))})`);
      continue;
    }
    removed += 1;
    lines.push(`removed: .worktrees/${display(entry.slug)}  (branch=${display(entry.branch)})`);
  }
  return { removed, skipped, failed, lines };
}

export function summaryLine({ removed, skipped, failed }, kept) {
  return `Removed ${removed}, skipped ${skipped}, failed ${failed}, kept ${kept}.`;
}

function git(args, cwd, env, { trim = true } = {}) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${firstLine(result.stderr)}`);
  return trim ? result.stdout.trim() : result.stdout;
}

function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function firstLine(text) {
  return String(text ?? '').trim().split('\n')[0] ?? '';
}

/** Replaces control and non-ASCII characters in text that came from a tool, and caps its length. */
function clean(text) {
  const ascii = String(text).replace(/[^\u0020-\u007e]/g, '?');
  return ascii.length > 120 ? `${ascii.slice(0, 117)}...` : ascii;
}

/** Names that fail the name rule are shown JSON-quoted (ASCII only) and cut to 80 characters. */
function display(name) {
  if (SLUG_PATTERN.test(name) || BRANCH_PATTERN.test(name)) return name;
  const cut = name.length > 70 ? `${name.slice(0, 67)}...` : name;
  return JSON.stringify(cut).replace(/[^\u0020-\u007e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
