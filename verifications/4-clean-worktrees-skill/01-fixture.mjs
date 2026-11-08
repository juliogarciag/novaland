/**
 * V1: the skill's procedure, table-tested in a throwaway repository with a
 * fake `gh` on PATH. Covers every branch of the rule, every keep reason in
 * step 3, argument validation, the preview format, and a real removal with
 * the step 8 re-check. Nothing outside the temp directory is touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, check, summarize, writeProof } from './lib.mjs';
import { BRANCH_PATTERN, GH_COMMANDS, SLUG_PATTERN, classify, findRoot, parseAgeDays, preview, removeWorktrees, summaryLine } from './procedure.mjs';

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const results = [];
const output = [];
const log = (line = '') => {
  output.push(line);
  console.log(line);
};

// ---------------------------------------------------------------- fixture
// realpath: on macOS the temp dir is a symlink and git reports real paths.
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'clean-worktrees-')));
const root = path.join(tmp, 'repo');
const bin = path.join(tmp, 'bin');
const remote = path.join(tmp, 'remote.git');
const ghData = path.join(tmp, 'gh.json');
mkdirSync(bin);
writeFileSync(path.join(bin, 'gh'), FAKE_GH());
chmodSync(path.join(bin, 'gh'), 0o755);
const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  GH_FAKE_DATA: ghData,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
};
const git = (args, cwd = root, extra = {}) => {
  const r = spawnSync('git', args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const dateEnv = (ts) => ({ GIT_AUTHOR_DATE: `@${ts} +0000`, GIT_COMMITTER_DATE: `@${ts} +0000` });

// Main checkout, initial commit 30 days old so "cut from an old base" is testable.
mkdirSync(root);
git(['init', '-q', '-b', 'main']);
writeFileSync(path.join(root, 'README.md'), 'fixture\n');
git(['add', '.']);
git(['commit', '-q', '-m', 'init'], root, dateEnv(now - 30 * DAY));
git(['init', '-q', '--bare', remote]);
git(['remote', 'add', 'origin', remote]);
git(['push', '-q', '-u', 'origin', 'main']);

const prs = {};
const issues = {};
const expected = [];
function addWorktree({ slug, branch = slug, commitAge = 0, gitFileAge = commitAge, pr, issue, expect, after }) {
  const wt = path.join(root, '.worktrees', slug);
  git(['worktree', 'add', '-q', wt, '-b', branch]);
  if (commitAge !== null) {
    writeFileSync(path.join(wt, 'work.txt'), `${slug}\n`);
    git(['add', '.'], wt);
    git(['commit', '-q', '-m', `work on ${slug}`], wt, dateEnv(now - commitAge * DAY));
  }
  const gitFileTime = now - gitFileAge * DAY;
  utimesSync(path.join(wt, '.git'), gitFileTime, gitFileTime);
  if (pr) prs[branch] = pr;
  if (issue) issues[branch.split('-')[0]] = issue;
  if (after) after(wt);
  expected.push({ slug, ...expect });
  return wt;
}

addWorktree({ slug: '1-merged', pr: [{ number: 3, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR merged (#3), ticket closed (#1)' } });
addWorktree({ slug: '2-mixed', pr: [{ number: 12, state: 'MERGED' }], issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#2), PR merged (#12); close the ticket to let this be cleaned' } });
addWorktree({ slug: '3-no-pr', issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#3), no PR yet' } });
addWorktree({ slug: '4-closed-pr', pr: [{ number: 14, state: 'CLOSED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR closed (#14), ticket closed (#4)' } });
addWorktree({ slug: 'old-untracked', commitAge: 12, expect: { verdict: 'REMOVE', reason: 'no trackers, 12d old' } });
addWorktree({ slug: 'fresh-untracked', commitAge: 2, expect: { verdict: 'keep', reason: 'no trackers, 2d old (< 7d)' } });
addWorktree({ slug: '5-ticket-error', issue: { error: 'error connecting to api.github.com' }, expect: { verdict: 'keep', reason: 'could not verify ticket (error connecting to api.github.com)' } });
addWorktree({ slug: '6-pr-error', pr: { error: 'HTTP 401: Bad credentials' }, issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'could not verify PR (HTTP 401: Bad credentials)' } });
addWorktree({ slug: '7-dirty', pr: [{ number: 17, state: 'MERGED' }], issue: { state: 'CLOSED' }, after: (wt) => writeFileSync(path.join(wt, 'notes.txt'), 'wip\n'), expect: { verdict: 'keep', reason: 'uncommitted changes' } });
addWorktree({ slug: '8-locked', pr: [{ number: 18, state: 'MERGED' }], issue: { state: 'CLOSED' }, after: (wt) => git(['worktree', 'lock', wt]), expect: { verdict: 'keep', reason: 'locked' } });
const busy = addWorktree({ slug: '9-busy', pr: [{ number: 19, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: /^running process \(pid \d+\)$/ } });
addWorktree({ slug: '10-detached', after: (wt) => git(['checkout', '-q', '--detach'], wt), expect: { verdict: 'keep', reason: 'detached' } });
addWorktree({ slug: '11-prnum', commitAge: 12, issue: { state: 'OPEN', url: 'https://github.com/x/y/pull/11' }, expect: { verdict: 'REMOVE', reason: 'no trackers, 12d old' } });
addWorktree({ slug: '12-cross', pr: [{ number: 40, state: 'MERGED', isCrossRepository: true }], issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#12), no PR yet' } });
addWorktree({ slug: '13-bad$name', branch: '13-badname', expect: { verdict: 'keep', reason: 'unusual name' } });
addWorktree({ slug: '15-old-base', commitAge: null, gitFileAge: 0, expect: { verdict: 'keep', reason: 'no trackers, 0d old (< 7d)' } });
const unpushed = addWorktree({ slug: '16-unpushed', pr: [{ number: 26, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR merged (#26), ticket closed (#16)', unpushed: 1 } });
git(['push', '-q', '-u', 'origin', '16-unpushed'], unpushed);
writeFileSync(path.join(unpushed, 'more.txt'), 'more\n');
git(['add', '.'], unpushed);
git(['commit', '-q', '-m', 'unpushed'], unpushed);
// A worktree outside .worktrees/ and one on the default branch.
const outside = path.join(tmp, 'outside-wt');
git(['worktree', 'add', '-q', outside, '-b', '14-outside']);
expected.push({ slug: 'outside-wt', verdict: 'keep', reason: 'outside .worktrees/' });
git(['switch', '-q', '-c', 'trunk']);
git(['worktree', 'add', '-q', path.join(root, '.worktrees', 'main-wt'), 'main']);
expected.push({ slug: 'main-wt', verdict: 'keep', reason: 'default branch' });
writeFileSync(ghData, JSON.stringify({ prs, issues }));
const sleeper = spawn('sleep', ['120'], { cwd: busy, stdio: 'ignore' });

try {
  // ------------------------------------------------------------ step 1
  log('=== step 1: argument validation ===');
  results.push(check('no argument means 7 days', parseAgeDays(undefined) === 7 && parseAgeDays('') === 7));
  results.push(check('a positive integer is accepted', parseAgeDays('20') === 20 && parseAgeDays('1') === 1));
  results.push(check('0, negatives and words are rejected', [parseAgeDays('0'), parseAgeDays('-2'), parseAgeDays('abc'), parseAgeDays('7; rm -rf /')].every((v) => v === null)));

  // ------------------------------------------------------------ step 2
  log('\n=== step 2: ROOT resolution ===');
  const fromWorktree = findRoot(path.join(root, '.worktrees', '3-no-pr'), env);
  const fromRoot = findRoot(root, env);
  const fromWorktreesDir = findRoot(path.join(root, '.worktrees'), env);
  results.push(check('ROOT is the main checkout from a worktree, the root and the .worktrees dir', [fromWorktree, fromRoot, fromWorktreesDir].every((r) => r === root), fromWorktree));

  // ------------------------------------------------------------ steps 3-5
  log('\n=== steps 3-5: one verdict per worktree ===');
  const entries = classify({ root, cwd: root, now, ageDays: 7, env });
  for (const want of expected) {
    const got = entries.find((e) => e.slug === want.slug);
    const reasonOk = want.reason instanceof RegExp ? want.reason.test(got?.reason ?? '') : got?.reason === want.reason;
    const unpushedOk = want.unpushed === undefined || got?.unpushed === want.unpushed;
    results.push(check(`${want.slug}: ${want.verdict} — ${want.reason}`, got !== undefined && got.verdict === want.verdict && reasonOk && unpushedOk, got ? `${got.verdict} — ${got.reason}${got.unpushed ? ` unpushed=${got.unpushed}` : ''}` : 'missing'));
  }
  results.push(check('every non-main worktree got exactly one verdict', entries.length === expected.length, `${entries.length} of ${expected.length}`));
  const fromInside = classify({ root, cwd: path.join(root, '.worktrees', '3-no-pr'), now, ageDays: 7, env });
  results.push(check('the worktree the session runs in is kept as current session', fromInside.find((e) => e.slug === '3-no-pr')?.reason === 'current session'));
  const withLongerAge = classify({ root, cwd: root, now, ageDays: 20, env });
  results.push(check('a 20-day threshold keeps the 12-day-old untracked worktree', withLongerAge.find((e) => e.slug === 'old-untracked')?.reason === 'no trackers, 12d old (< 20d)'));

  // ------------------------------------------------------------ step 6
  log('\n=== step 6: preview ===');
  const lines = preview(entries, 7);
  for (const line of lines) log(line);
  const removeLines = lines.filter((l) => l.startsWith('REMOVE'));
  const keepLines = lines.filter((l) => l.startsWith('keep'));
  const expectedRemovable = expected.filter((e) => e.verdict === 'REMOVE').length;
  results.push(check('REMOVE lines come first, then keep lines', lines.findIndex((l) => l.startsWith('keep')) > removeLines.length - 1 && removeLines.length === expectedRemovable, `${removeLines.length} removable`));
  const slugsIn = (group) => group.map((l) => /\.worktrees\/(\S+)/.exec(l)[1]);
  const sorted = (arr) => arr.every((s, i) => i === 0 || arr[i - 1].localeCompare(s) <= 0);
  results.push(check('each group is alphabetical by slug', sorted(slugsIn(removeLines)) && sorted(slugsIn(keepLines))));
  results.push(check('every line matches the skill format', [...removeLines, ...keepLines].every((l) => /^(REMOVE|keep)\s+\.worktrees\/\S+\s+branch=\S+\s+— (unused|keep): .+$/.test(l))));
  results.push(check('unpushed commits are shown', removeLines.some((l) => l.includes('16-unpushed') && l.endsWith('unpushed=1'))));
  results.push(check('the summary line counts and warns about ignored files', lines.at(-1) === `${expectedRemovable} to remove, ${expected.length - expectedRemovable} to keep. Removal also deletes ignored files (node_modules, .env, local logs).`));
  results.push(check('with nothing removable the preview says so and stops', preview(entries.filter((e) => e.verdict === 'keep'), 7).at(-1).startsWith('Nothing to remove')));

  // ------------------------------------------------------------ steps 8-9
  log('\n=== steps 8-9: removal with the re-check ===');
  const plan = entries.filter((e) => e.verdict === 'REMOVE');
  writeFileSync(path.join(root, '.worktrees', '4-closed-pr', 'late.txt'), 'edited after the preview\n');
  git(['worktree', 'lock', path.join(root, '.worktrees', '11-prnum')]);
  const before = git(['branch', '--list']).split('\n').length;
  const outcome = removeWorktrees({ root, plan, env });
  for (const line of outcome.lines) log(line);
  const kept = entries.length - plan.length;
  log(summaryLine(outcome, kept));
  results.push(check('a worktree dirtied after the preview is skipped, not removed', outcome.lines.some((l) => l === 'skipped: .worktrees/4-closed-pr  (uncommitted changes)') && existsSync(path.join(root, '.worktrees', '4-closed-pr', 'late.txt'))));
  results.push(check('a git refusal is reported as failed and the run continues', outcome.lines.some((l) => l.startsWith('failed: .worktrees/11-prnum')) && outcome.lines.at(-1).startsWith('removed: .worktrees/old-untracked')));
  results.push(check('the clean ones are removed and reported with their branch', ['1-merged', '16-unpushed', 'old-untracked'].every((s) => !existsSync(path.join(root, '.worktrees', s)) && outcome.lines.includes(`removed: .worktrees/${s}  (branch=${s})`))));
  results.push(check('branches survive removal', git(['branch', '--list']).split('\n').length === before, `${before} branches`));
  results.push(check('the final summary has the four counts', summaryLine(outcome, kept) === `Removed 3, skipped 1, failed 1, kept ${kept}.`));
  results.push(check('kept worktrees are untouched', expected.filter((e) => e.verdict === 'keep' && e.slug !== 'outside-wt').every((e) => existsSync(path.join(root, '.worktrees', e.slug)))));

  // ------------------------------------------------------------ SKILL.md
  log('\n=== SKILL.md matches this procedure ===');
  const skillDir = path.join(REPO, '.claude', 'skills', 'clean-worktrees');
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const frontmatter = Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? '').split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  results.push(check('frontmatter name matches the folder', frontmatter.name === path.basename(skillDir)));
  results.push(check('frontmatter has description and argument-hint', frontmatter.description?.length > 40 && frontmatter['argument-hint'] === '[age-days]'));
  results.push(check('the skill cannot be auto-invoked by the model', frontmatter['disable-model-invocation'] === 'true'));
  results.push(check('the skill prescribes the gh commands this procedure runs', skill.includes(GH_COMMANDS.prList) && skill.includes(GH_COMMANDS.issueView)));
  results.push(check('the skill states the name patterns this procedure enforces', skill.includes(SLUG_PATTERN.source) && skill.includes(BRANCH_PATTERN.source)));
  results.push(check('the skill lists every keep reason the procedure can produce', ['bare', 'prunable', 'locked', 'detached', 'outside .worktrees/', 'unusual name', 'default branch', 'current session', 'uncommitted changes', 'running process', 'could not verify', 'could not check for running processes'].every((r) => skill.includes(r))));
} finally {
  sleeper.kill();
  rmSync(tmp, { recursive: true, force: true });
}

const ok = summarize(results);
output.push('', ok ? `ALL ${results.length} CHECKS PASSED` : 'SOME CHECKS FAILED');
writeProof('01-fixture.txt', `# ${new Date().toISOString()}  node ${process.version}\n` + output.join('\n') + '\n', { [tmp]: '<tmp>' });
process.exit(ok ? 0 : 1);

function FAKE_GH() {
  return `#!/usr/bin/env node
// Fake gh for the clean-worktrees verification. Answers from GH_FAKE_DATA.
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.env.GH_FAKE_DATA, 'utf8'));
const [a, b, ...rest] = process.argv.slice(2);
function fail(msg) { process.stderr.write(msg + '\\n'); process.exit(1); }
if (a === 'auth' && b === 'status') process.exit(0);
if (a === 'pr' && b === 'list') {
  const branch = rest[rest.indexOf('--head') + 1];
  const entry = data.prs[branch] ?? [];
  if (entry.error) fail(entry.error);
  process.stdout.write(JSON.stringify(entry.map((p) => ({ number: p.number, state: p.state, isCrossRepository: p.isCrossRepository ?? false }))));
  process.exit(0);
}
if (a === 'issue' && b === 'view') {
  const n = rest[0];
  const entry = data.issues[n];
  if (!entry) fail('GraphQL: Could not resolve to an issue or pull request with the number of ' + n + '. (repository.issue)');
  if (entry.error) fail(entry.error);
  process.stdout.write(JSON.stringify({ state: entry.state, url: entry.url ?? 'https://github.com/x/y/issues/' + n }));
  process.exit(0);
}
fail('fake gh: unsupported ' + process.argv.slice(2).join(' '));
`;
}
