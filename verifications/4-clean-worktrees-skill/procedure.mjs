/**
 * Reference implementation of .claude/skills/clean-worktrees/SKILL.md, step
 * for step, so the verification can table-test every branch of the rule.
 * The skill text is what agents follow; this file mirrors it and must be
 * kept in sync (01-fixture.mjs checks the commands match).
 */
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_AGE_DAYS = 7;
export const SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;
export const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

/** The exact gh commands the skill prescribes; the fixture test asserts SKILL.md contains them. */
export const GH_COMMANDS = {
  prList: "gh pr list --head '<branch>' --state all --json number,state,isCrossRepository",
  issueView: 'gh issue view <n> --json state,url',
};

/** Step 1. */
export function parseAgeDays(argument) {
  if (argument === undefined || argument === '') return DEFAULT_AGE_DAYS;
  if (!/^\d{1,4}$/.test(argument)) return null;
  const days = Number(argument);
  return days >= 1 ? days : null;
}

/** Step 2. */
export function findRoot(cwd, env) {
  return path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, env));
}

/** Step 3, parsing only. */
export function listWorktrees(root, env) {
  const text = git(['worktree', 'list', '--porcelain'], root, env);
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const entry = { path: '', branch: null, detached: false, locked: false, prunable: false, bare: false };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) entry.path = line.slice(9);
        else if (line.startsWith('branch refs/heads/')) entry.branch = line.slice(18);
        else if (line === 'detached') entry.detached = true;
        else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true;
        else if (line === 'prunable' || line.startsWith('prunable ')) entry.prunable = true;
        else if (line === 'bare') entry.bare = true;
      }
      return entry;
    });
}

/** Steps 3 to 5: one verdict per worktree other than the main one. */
export function classify({ root, cwd, now, ageDays, env = process.env }) {
  const realRoot = realpathSync(root);
  const realCwd = realpathSync(cwd);
  const entries = [];
  for (const worktree of listWorktrees(root, env)) {
    if (worktree.path === root || safeRealpath(worktree.path) === realRoot) continue;
    const slug = path.basename(worktree.path);
    const entry = { path: worktree.path, slug, branch: worktree.branch ?? 'HEAD', verdict: 'keep', reason: '', unpushed: 0 };
    entries.push(entry);
    const keep = (reason) => {
      entry.reason = reason;
    };

    if (worktree.bare) { keep('bare'); continue; }
    if (worktree.prunable) { keep('prunable (run git worktree prune)'); continue; }
    if (worktree.locked) { keep('locked'); continue; }
    if (worktree.detached || worktree.branch === null) { keep('detached'); continue; }
    const realPath = safeRealpath(worktree.path);
    if (realPath !== path.join(realRoot, '.worktrees', slug)) { keep('outside .worktrees/'); continue; }
    if (!SLUG_PATTERN.test(slug) || !BRANCH_PATTERN.test(worktree.branch)) { keep('unusual name'); continue; }
    if (worktree.branch === 'main') { keep('default branch'); continue; }
    if (realCwd === realPath || realCwd.startsWith(realPath + path.sep)) { keep('current session'); continue; }
    const liveness = checkLiveness(worktree.path, realPath, env);
    if (liveness) { keep(liveness); continue; }

    const lastCommitTs = Number(git(['log', '-1', '--format=%ct', 'HEAD'], worktree.path, env));
    const gitFileMtime = Math.floor(statSync(path.join(worktree.path, '.git')).mtimeMs / 1000);
    const ageDaysOfWorktree = Math.floor((now - Math.max(lastCommitTs, gitFileMtime)) / 86400);
    const unpushed = spawnSync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: worktree.path, env, encoding: 'utf8' });
    entry.unpushed = unpushed.status === 0 ? Number(unpushed.stdout.trim()) : 0;

    const trackers = discoverTrackers(root, worktree.branch, env);
    if (trackers.error) { keep(trackers.error); continue; }
    if (trackers.list.length === 0) {
      const unused = ageDaysOfWorktree >= ageDays;
      entry.verdict = unused ? 'REMOVE' : 'keep';
      entry.reason = `no trackers, ${ageDaysOfWorktree}d old${unused ? '' : ` (< ${ageDays}d)`}`;
      continue;
    }
    const open = trackers.list.filter((t) => !t.terminal);
    const closed = trackers.list.filter((t) => t.terminal);
    const describe = (t) => `${t.kind} ${t.state.toLowerCase()} (#${t.number})`;
    if (open.length === 0) {
      entry.verdict = 'REMOVE';
      entry.reason = closed.map(describe).join(', ');
      continue;
    }
    let reason = open.map(describe).join(', ');
    if (!trackers.list.some((t) => t.kind === 'PR')) reason += ', no PR yet';
    else if (closed.length > 0) reason += `, ${closed.map(describe).join(', ')}`;
    if (open.some((t) => t.kind === 'ticket') && closed.some((t) => t.kind === 'PR' && t.state === 'MERGED')) {
      reason += '; close the ticket to let this be cleaned';
    }
    entry.reason = reason;
  }
  entries.sort((a, b) => (a.verdict === b.verdict ? a.slug.localeCompare(b.slug) : a.verdict === 'REMOVE' ? -1 : 1));
  return entries;
}

/** Step 3: uncommitted changes and running processes, also re-run in step 8. */
export function checkLiveness(worktreePath, realPath, env) {
  const status = git(['status', '--porcelain'], worktreePath, env);
  if (status !== '') return 'uncommitted changes';
  const lsof = spawnSync('lsof', ['-nP', '-d', 'cwd', '-Fpn'], { env, encoding: 'utf8' });
  if (lsof.error || (lsof.status !== 0 && lsof.stdout === '')) return 'could not check for running processes';
  let pid = null;
  for (const line of lsof.stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n')) {
      const dir = line.slice(1);
      if (dir === realPath || dir.startsWith(realPath + path.sep)) return `running process (pid ${pid})`;
    }
  }
  return null;
}

/** Step 4. */
export function discoverTrackers(root, branch, env) {
  const list = [];
  const prs = spawnSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,isCrossRepository'], { cwd: root, env, encoding: 'utf8' });
  if (prs.status !== 0) return { error: `could not verify PR (${firstLine(prs.stderr)})`, list };
  for (const pr of JSON.parse(prs.stdout)) {
    if (pr.isCrossRepository) continue;
    list.push({ kind: 'PR', number: pr.number, state: pr.state, terminal: pr.state === 'MERGED' || pr.state === 'CLOSED' });
  }
  const ticket = /^(\d+)-/.exec(branch);
  if (ticket) {
    const issue = spawnSync('gh', ['issue', 'view', ticket[1], '--json', 'state,url'], { cwd: root, env, encoding: 'utf8' });
    if (issue.status !== 0) {
      if (!/Could not resolve to an issue/.test(issue.stderr)) return { error: `could not verify ticket (${firstLine(issue.stderr)})`, list };
    } else {
      const data = JSON.parse(issue.stdout);
      if (!String(data.url).includes('/pull/')) {
        list.push({ kind: 'ticket', number: Number(ticket[1]), state: data.state, terminal: data.state === 'CLOSED' });
      }
    }
  }
  return { list };
}

/** Step 6. */
export function preview(entries, ageDays = DEFAULT_AGE_DAYS) {
  const removable = entries.filter((e) => e.verdict === 'REMOVE').length;
  const width = Math.max(0, ...entries.map((e) => e.slug.length + 11));
  const branchWidth = Math.max(0, ...entries.map((e) => e.branch.length + 7));
  const lines = entries.map((e) => {
    const prefix = e.verdict === 'REMOVE' ? 'unused' : 'keep';
    const unpushed = e.unpushed > 0 ? `  unpushed=${e.unpushed}` : '';
    return `${e.verdict.padEnd(6)}  ${`.worktrees/${e.slug}`.padEnd(width)}  ${`branch=${e.branch}`.padEnd(branchWidth)}  — ${prefix}: ${e.reason}${unpushed}`;
  });
  lines.push(
    removable === 0
      ? `Nothing to remove (${entries.length} kept, age threshold ${ageDays}d).`
      : `${removable} to remove, ${entries.length - removable} to keep. Removal also deletes ignored files (node_modules, .env, local logs).`,
  );
  return lines;
}

/** Steps 8 and 9. `plan` is the REMOVE entries from the preview, in order. Never forces. */
export function removeWorktrees({ root, plan, env = process.env }) {
  const lines = [];
  let removed = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of plan) {
    const liveness = checkLiveness(entry.path, safeRealpath(entry.path), env);
    if (liveness) {
      skipped += 1;
      lines.push(`skipped: .worktrees/${entry.slug}  (${liveness})`);
      continue;
    }
    const result = spawnSync('git', ['-C', root, 'worktree', 'remove', '--', entry.path], { env, encoding: 'utf8' });
    if (result.status !== 0) {
      failed += 1;
      lines.push(`failed: .worktrees/${entry.slug}  (${firstLine(result.stderr)})`);
      continue;
    }
    removed += 1;
    lines.push(`removed: .worktrees/${entry.slug}  (branch=${entry.branch})`);
  }
  return { removed, skipped, failed, lines };
}

export function summaryLine({ removed, skipped, failed }, kept) {
  return `Removed ${removed}, skipped ${skipped}, failed ${failed}, kept ${kept}.`;
}

function git(args, cwd, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${firstLine(result.stderr)}`);
  return result.stdout.trim();
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
