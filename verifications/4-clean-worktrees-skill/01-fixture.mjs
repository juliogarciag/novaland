/**
 * V1: the skill's procedure, table-tested in a throwaway repository with a
 * fake `gh` and a recording `git` shim on PATH. Covers every branch of the
 * rule, every keep reason of step 3, argument validation, the preview, the
 * confirmation question, and a real removal with the step 8 re-check.
 * Nothing outside the temp directory is touched; it is deleted on exit.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, summarize, writeProof } from './lib.mjs';
import {
  AGE_ARGUMENT_PATTERN,
  BRANCH_PATTERN,
  COMMIT_PATTERN,
  DEFAULT_AGE_DAYS,
  GH_COMMANDS,
  KEEP_ORDER,
  NUMBER_PATTERN,
  SLUG_PATTERN,
  TICKET_PATTERN,
  classify,
  confirmationQuestion,
  findRoot,
  parseAgeDays,
  preview,
  removeWorktrees,
  summaryLine,
} from './procedure.mjs';

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
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

// realpath: on macOS the temp dir is a symlink and git reports real paths.
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'clean-worktrees-')));
const root = path.join(tmp, 'repo');
const bin = path.join(tmp, 'bin');
const binLsofFail = path.join(tmp, 'bin-lsof-fail');
const remote = path.join(tmp, 'remote.git');
const ghData = path.join(tmp, 'gh.json');
const ghLog = path.join(tmp, 'gh.log');
const gitLog = path.join(tmp, 'git.log');
const readOnlyDir = path.join(root, '.worktrees', '25-boundary', 'ignored');
const children = [];
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) child.kill();
  try {
    chmodSync(readOnlyDir, 0o755);
  } catch {
    /* not created */
  }
  rmSync(tmp, { recursive: true, force: true });
}
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

try {
  // ---------------------------------------------------------------- fixture
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  if (!path.isAbsolute(realGit)) throw new Error(`cannot resolve git: ${JSON.stringify(realGit)}`);
  mkdirSync(bin);
  mkdirSync(binLsofFail);
  writeFileSync(path.join(bin, 'gh'), FAKE_GH());
  writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GIT_SHIM_LOG"\nexec "$REAL_GIT" "$@"\n`);
  writeFileSync(path.join(binLsofFail, 'lsof'), '#!/bin/sh\nexit 1\n');
  for (const file of ['gh', 'git']) chmodSync(path.join(bin, file), 0o755);
  chmodSync(path.join(binLsofFail, 'lsof'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: tmp,
    REAL_GIT: realGit,
    GIT_SHIM_LOG: gitLog,
    GH_FAKE_DATA: ghData,
    GH_FAKE_LOG: ghLog,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  const envLsofFail = { ...env, PATH: `${binLsofFail}${path.delimiter}${env.PATH}` };
  const git = (args, cwd = root, extra = {}) => {
    const r = spawnSync('git', args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const dateEnv = (ts) => ({ GIT_AUTHOR_DATE: `@${ts} +0000`, GIT_COMMITTER_DATE: `@${ts} +0000` });
  const wtPath = (slug) => path.join(root, '.worktrees', slug);

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
  const rows = [];
  function addWorktree({ slug, branch = slug, commitAge = 0, gitFileAge = commitAge, pr, issue, expect, after }) {
    const wt = wtPath(slug);
    git(['worktree', 'add', '-q', wt, '-b', branch]);
    if (commitAge !== null) {
      writeFileSync(path.join(wt, 'work.txt'), `${slug}\n`);
      git(['add', '.'], wt);
      git(['commit', '-q', '-m', `work on ${slug}`], wt, dateEnv(now - commitAge * DAY));
    }
    const gitFileTime = now - gitFileAge * DAY;
    utimesSync(path.join(wt, '.git'), gitFileTime, gitFileTime);
    if (pr) prs[branch] = Array.isArray(pr) ? pr.map((p) => ({ headRefOid: git(['rev-parse', 'HEAD'], wt), ...p })) : pr;
    if (issue) issues[branch.split('-')[0]] = issue;
    if (after) after(wt);
    rows.push({ slug, ...expect });
    return wt;
  }

  addWorktree({ slug: '1-merged', pr: [{ number: 3, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR merged (#3), ticket closed (#1)', issueLookup: true } });
  addWorktree({ slug: '2-mixed', pr: [{ number: 12, state: 'MERGED' }], issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#2), PR merged (#12); close the ticket to let this be cleaned', issueLookup: true } });
  addWorktree({ slug: '3-no-pr', issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#3), no PR yet', issueLookup: true } });
  addWorktree({ slug: '4-closed-pr', pr: [{ number: 14, state: 'CLOSED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR closed (#14), ticket closed (#4)', issueLookup: true } });
  addWorktree({ slug: 'old-untracked', commitAge: 12, expect: { verdict: 'REMOVE', reason: 'no trackers, 12d old' } });
  addWorktree({ slug: 'fresh-untracked', commitAge: 2, expect: { verdict: 'keep', reason: 'no trackers, 2d old (< 7d)' } });
  addWorktree({ slug: '5-ticket-error', issue: { error: 'error connecting to api.github.com' }, expect: { verdict: 'keep', reason: 'could not verify ticket (error connecting to api.github.com)', issueLookup: true } });
  addWorktree({ slug: '6-pr-error', pr: { error: 'HTTP 401: Bad credentials' }, issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'could not verify PR (HTTP 401: Bad credentials)' } });
  addWorktree({ slug: '7-dirty', pr: [{ number: 17, state: 'MERGED' }], issue: { state: 'CLOSED' }, after: (wt) => writeFileSync(path.join(wt, 'notes.txt'), 'wip\n'), expect: { verdict: 'keep', reason: 'uncommitted changes' } });
  addWorktree({ slug: '8-locked', pr: [{ number: 18, state: 'MERGED' }], issue: { state: 'CLOSED' }, after: (wt) => git(['worktree', 'lock', wt]), expect: { verdict: 'keep', reason: 'locked' } });
  const busy = addWorktree({ slug: '9-busy', pr: [{ number: 19, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: /^running process \(pid \d+\); stop it to let this be cleaned$/ } });
  addWorktree({ slug: '10-detached', after: (wt) => git(['checkout', '-q', '--detach'], wt), expect: { verdict: 'keep', reason: 'detached' } });
  addWorktree({ slug: '11-prnum', commitAge: 12, issue: { state: 'OPEN', url: 'https://github.com/x/y/pull/11' }, expect: { verdict: 'REMOVE', reason: 'no trackers, 12d old', issueLookup: true } });
  addWorktree({ slug: '12-cross', pr: [{ number: 40, state: 'MERGED', isCrossRepository: true }], issue: { state: 'OPEN' }, expect: { verdict: 'keep', reason: 'ticket open (#12), no PR yet', issueLookup: true } });
  addWorktree({ slug: '13-bad$name', branch: '13-badname', expect: { verdict: 'keep', reason: 'unusual name' } });
  addWorktree({ slug: '15-old-base', commitAge: null, gitFileAge: 0, expect: { verdict: 'keep', reason: 'no trackers, 0d old (< 7d)', issueLookup: true } });
  const unpushed = addWorktree({ slug: '16-unpushed', issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'PR merged (#26) but HEAD is not in the PR head, ticket closed (#16)', unpushed: 1, issueLookup: true } });
  git(['push', '-q', '-u', 'origin', '16-unpushed'], unpushed);
  prs['16-unpushed'] = [{ number: 26, state: 'MERGED', headRefOid: git(['rev-parse', 'HEAD'], unpushed) }];
  writeFileSync(path.join(unpushed, 'more.txt'), 'more\n');
  git(['add', '.'], unpushed);
  git(['commit', '-q', '-m', 'unpushed'], unpushed);
  addWorktree({ slug: '17-open-pr', pr: [{ number: 27, state: 'OPEN' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'PR open (#27), ticket closed (#17)', issueLookup: true } });
  addWorktree({ slug: '18-two-prs', pr: [{ number: 28, state: 'CLOSED' }, { number: 29, state: 'OPEN' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'PR open (#29), PR closed (#28), ticket closed (#18)', issueLookup: true } });
  const ticketOnly = addWorktree({ slug: '19-ticket-only', issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'ticket closed (#19)', issueLookup: true } });
  addWorktree({ slug: 'nonum-merged', pr: [{ number: 30, state: 'MERGED' }], expect: { verdict: 'REMOVE', reason: 'PR merged (#30)' } });
  addWorktree({ slug: '20-prunable', after: (wt) => rmSync(wt, { recursive: true }), expect: { verdict: 'keep', reason: 'prunable (run git worktree prune)' } });
  addWorktree({ slug: '21-badbranch', branch: '21-bad@x', expect: { verdict: 'keep', reason: 'unusual name' } });
  addWorktree({ slug: '22-differs', branch: '22-other', expect: { verdict: 'keep', reason: 'worktree and branch names differ' } });
  const nested = addWorktree({ slug: '23-nested', pr: [{ number: 33, state: 'MERGED' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: /^contains another worktree \(.*23-nested\/inner\)$/ } });
  git(['worktree', 'add', '-q', path.join(nested, 'inner'), '-b', '24-inner']);
  rows.push({ slug: 'inner', verdict: 'keep', reason: 'outside .worktrees/' });
  addWorktree({
    slug: '25-boundary',
    commitAge: 7,
    after: (wt) => {
      writeFileSync(path.join(wt, '.gitignore'), 'ignored/\n');
      git(['add', '.gitignore'], wt);
      git(['commit', '-q', '-m', 'ignore'], wt, dateEnv(now - 7 * DAY));
      mkdirSync(path.join(wt, 'ignored'));
      writeFileSync(path.join(wt, 'ignored', 'cache.bin'), 'x\n');
    },
    expect: { verdict: 'REMOVE', reason: 'no trackers, 7d old', issueLookup: true },
  });
  addWorktree({ slug: '26-fresh-gitfile', commitAge: 12, gitFileAge: 0, expect: { verdict: 'keep', reason: 'no trackers, 0d old (< 7d)', issueLookup: true } });
  addWorktree({ slug: '27-weird', pr: [{ number: 37, state: 'FOO' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'unknown PR state (FOO)' } });
  // HEAD strictly behind the merged PR head: contained, so terminal.
  const behind = addWorktree({ slug: '29-behind', issue: { state: 'CLOSED' }, expect: { verdict: 'REMOVE', reason: 'PR merged (#39), ticket closed (#29)', issueLookup: true } });
  writeFileSync(path.join(behind, 'later.txt'), 'later\n');
  git(['add', '.'], behind);
  git(['commit', '-q', '-m', 'later'], behind);
  prs['29-behind'] = [{ number: 39, state: 'MERGED', headRefOid: git(['rev-parse', 'HEAD'], behind) }];
  git(['reset', '-q', '--hard', 'HEAD~1'], behind);
  addWorktree({ slug: '30-bad-oid', pr: [{ number: 40, state: 'MERGED', headRefOid: 'HEAD' }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: 'could not verify PR (bad value)' } });
  addWorktree({ slug: '31-ticket-weird', issue: { state: 'FOO' }, expect: { verdict: 'keep', reason: 'unknown ticket state (FOO)', issueLookup: true } });
  addWorktree({ slug: '32-multiline', pr: { error: 'line one\nline two \u001b[31mred' }, expect: { verdict: 'keep', reason: 'could not verify PR (line one)' } });
  addWorktree({ slug: '33-not-json', pr: { raw: 'not json at all' }, expect: { verdict: 'keep', reason: 'could not verify PR (output is not JSON)' } });
  addWorktree({ slug: '34-unknown-oid', pr: [{ number: 44, state: 'MERGED', headRefOid: 'f'.repeat(40) }], issue: { state: 'CLOSED' }, expect: { verdict: 'keep', reason: `could not verify PR (commit ${'f'.repeat(40)} not found locally)` } });
  const longSlug = `35-${'x'.repeat(90)}$`;
  addWorktree({ slug: longSlug, branch: '35-long', expect: { verdict: 'keep', reason: 'unusual name' } });
  const outside = path.join(tmp, 'outside-wt');
  git(['worktree', 'add', '-q', outside, '-b', '14-outside']);
  rows.push({ slug: 'outside-wt', verdict: 'keep', reason: 'outside .worktrees/' });
  git(['switch', '-q', '-c', 'trunk']);
  git(['worktree', 'add', '-q', wtPath('main'), 'main']);
  rows.push({ slug: 'main', verdict: 'keep', reason: 'default branch' });
  writeFileSync(ghData, JSON.stringify({ prs, issues }));
  children.push(spawn('sleep', ['300'], { cwd: busy, stdio: 'ignore' }));
  rmSync(gitLog, { force: true });

  // ------------------------------------------------------------ step 1
  log('=== step 1: argument validation ===');
  check('no argument means 7 days', parseAgeDays(undefined) === DEFAULT_AGE_DAYS && parseAgeDays('') === 7);
  check('1 and 9999 are accepted', parseAgeDays('1') === 1 && parseAgeDays('9999') === 9999);
  check('0, 10000, 007, +3, 3.0, negatives and words are rejected', ['0', '10000', '007', '+3', '3.0', '-2', 'abc', '7; rm -rf /'].every((v) => parseAgeDays(v) === null));
  check('surrounding whitespace is trimmed', parseAgeDays(' 3 ') === 3);

  // ------------------------------------------------------------ step 2
  log('\n=== step 2: ROOT resolution ===');
  const roots = [wtPath('3-no-pr'), root, path.join(root, '.worktrees'), path.join(nested, 'inner')].map((cwd) => findRoot(cwd, env));
  check('ROOT is the main checkout from a worktree, the root, the .worktrees dir and a nested worktree', roots.every((r) => r === root), roots[0]);

  // ------------------------------------------------------------ steps 3-5
  log('\n=== steps 3-5: one verdict per worktree ===');
  const entries = classify({ root, cwd: root, now, ageDays: 7, env });
  for (const want of rows) {
    const got = entries.find((e) => e.slug === want.slug);
    const reasonOk = want.reason instanceof RegExp ? want.reason.test(got?.reason ?? '') : got?.reason === want.reason;
    const unpushedOk = (want.unpushed ?? 0) === (got?.unpushed ?? -1);
    check(`${want.slug}: ${want.verdict} — ${want.reason}`, got !== undefined && got.verdict === want.verdict && reasonOk && unpushedOk, got ? `${got.verdict} — ${got.reason}${got.unpushed ? ` unpushed=${got.unpushed}` : ''}` : 'missing');
  }
  check('every non-main worktree got exactly one verdict', entries.length === rows.length, `${entries.length} of ${rows.length}`);
  const issueCalls = readFileSync(ghLog, 'utf8').split('\n').filter((l) => l.startsWith('issue view')).map((l) => l.split(' ')[2]).sort();
  const expectedIssueCalls = rows.filter((r) => r.issueLookup).map((r) => r.slug.split('-')[0]).sort();
  check('the ticket is looked up only for candidates whose branch starts with a number', JSON.stringify(issueCalls) === JSON.stringify(expectedIssueCalls), issueCalls.join(','));
  const fromInside = classify({ root, cwd: wtPath('3-no-pr'), now, ageDays: 7, env });
  check('the worktree the session runs in is kept as current session', fromInside.find((e) => e.slug === '3-no-pr')?.reason === 'current session');
  const withLongerAge = classify({ root, cwd: root, now, ageDays: 20, env });
  check('a 20-day threshold keeps the 12-day-old untracked worktree', withLongerAge.find((e) => e.slug === 'old-untracked')?.reason === 'no trackers, 12d old (< 20d)');
  const withoutLsof = classify({ root, cwd: root, now, ageDays: 7, env: envLsofFail });
  check('when lsof fails nothing is removable', withoutLsof.every((e) => e.verdict === 'keep') && withoutLsof.find((e) => e.slug === '1-merged')?.reason === 'could not check for running processes');

  // ------------------------------------------------------------ step 6
  log('\n=== step 6: preview ===');
  const lines = preview(entries, 7);
  for (const line of lines) log(line);
  const removeLines = lines.filter((l) => l.startsWith('REMOVE'));
  const keepLines = lines.filter((l) => l.startsWith('keep'));
  const slugsIn = (group) => group.map((l) => /\.worktrees\/(\S+)/.exec(l)[1]);
  check('REMOVE lines come first, in slug order', JSON.stringify(slugsIn(removeLines)) === JSON.stringify(['1-merged', '11-prnum', '19-ticket-only', '25-boundary', '29-behind', '4-closed-pr', 'nonum-merged', 'old-untracked']), slugsIn(removeLines).join(' '));
  const expectedKeepOrder = ['10-detached', '12-cross', '"13-bad$name"', '15-old-base', '16-unpushed', '17-open-pr', '18-two-prs', '2-mixed', '20-prunable', '21-badbranch', '22-differs', '23-nested', '26-fresh-gitfile', '27-weird', '3-no-pr', '30-bad-oid', '31-ticket-weird', '32-multiline', '33-not-json', '34-unknown-oid', `"35-${'x'.repeat(64)}..."`, '5-ticket-error', '6-pr-error', '7-dirty', '8-locked', '9-busy', 'fresh-untracked', 'inner', 'main', 'outside-wt'];
  check('keep lines follow, in slug order, with unusual names quoted and long ones cut', lines.indexOf(keepLines[0]) === removeLines.length && JSON.stringify(slugsIn(keepLines)) === JSON.stringify(expectedKeepOrder), slugsIn(keepLines).join(' '));
  check('every line matches the skill format', [...removeLines, ...keepLines].every((l) => /^(REMOVE|keep)\s+\.worktrees\/\S+\s+branch=\S+\s+— (unused|keep): .+$/.test(l)));
  check('unpushed commits are shown', keepLines.some((l) => l.includes('16-unpushed') && l.endsWith('unpushed=1')));
  check('the summary line counts and warns about ignored files', lines.at(-1) === `${removeLines.length} to remove, ${keepLines.length} to keep. Removal also deletes ignored files (node_modules, .env, local logs).`);
  check('with nothing removable the preview says so', preview(entries.filter((e) => e.verdict === 'keep'), 7).at(-1).startsWith('Nothing to remove'));

  // ------------------------------------------------------------ step 7
  log('\n=== step 7: confirmation ===');
  const plan = entries.filter((e) => e.verdict === 'REMOVE');
  const question = confirmationQuestion(plan);
  log(question);
  check('the question names every slug and the irreversible deletion', plan.every((e) => question.includes(e.slug)) && question.startsWith(`Remove these ${plan.length} worktrees?`) && question.includes('irreversibly'));

  // ------------------------------------------------------------ steps 8-9
  log('\n=== steps 8-9: removal with the re-check ===');
  writeFileSync(path.join(wtPath('4-closed-pr'), 'late.txt'), 'edited after the preview\n');
  git(['worktree', 'lock', wtPath('11-prnum')]);
  children.push(spawn('sleep', ['300'], { cwd: ticketOnly, stdio: 'ignore' }));
  writeFileSync(path.join(wtPath('nonum-merged'), 'after.txt'), 'after\n');
  git(['add', '.'], wtPath('nonum-merged'));
  git(['commit', '-q', '-m', 'after the preview'], wtPath('nonum-merged'));
  chmodSync(readOnlyDir, 0o555);
  const branchesBefore = git(['branch', '--format=%(refname:short)']);
  rmSync(gitLog, { force: true });
  const outcome = removeWorktrees({ root, plan, cwd: root, env });
  for (const line of outcome.lines) log(line);
  const kept = entries.length - plan.length;
  log(summaryLine(outcome, kept));
  const removeCalls = readFileSync(gitLog, 'utf8').split('\n').filter((l) => l.includes('worktree remove'));
  check('a worktree dirtied after the preview is skipped', outcome.lines.includes('skipped: .worktrees/4-closed-pr  (uncommitted changes)') && existsSync(path.join(wtPath('4-closed-pr'), 'late.txt')));
  check('a worktree locked after the preview is skipped', outcome.lines.includes('skipped: .worktrees/11-prnum  (locked)') && existsSync(wtPath('11-prnum')));
  check('a process started after the preview is skipped', outcome.lines.some((l) => /^skipped: \.worktrees\/19-ticket-only {2}\(running process \(pid \d+\)\)$/.test(l)) && existsSync(ticketOnly));
  check('a commit made after the preview is skipped', outcome.lines.includes('skipped: .worktrees/nonum-merged  (HEAD changed)') && existsSync(wtPath('nonum-merged')));
  const failedAt = outcome.lines.findIndex((l) => l.startsWith('failed: .worktrees/25-boundary'));
  check('a git refusal is reported as failed and the run continues', failedAt >= 0 && outcome.lines.slice(failedAt + 1).some((l) => l.startsWith('removed:')));
  check('the clean ones are removed and reported with their branch', ['1-merged', '29-behind', 'old-untracked'].every((s) => !existsSync(wtPath(s)) && outcome.lines.includes(`removed: .worktrees/${s}  (branch=${s})`)));
  check('git worktree remove was called only with -- and an absolute path, never --force', removeCalls.length === 4 && removeCalls.every((l) => /worktree remove -- \//.test(l) && !/(^| )(--force|-f)( |$)/.test(l)), `${removeCalls.length} calls`);
  check('no branch was deleted', !readFileSync(gitLog, 'utf8').split('\n').some((l) => /^branch (-d|-D|--delete)/.test(l)) && git(['branch', '--format=%(refname:short)']) === branchesBefore);
  check('the final summary has the four counts', summaryLine(outcome, kept) === `Removed 3, skipped 4, failed 1, kept ${kept}.`);
  check('kept worktrees are untouched', rows.filter((r) => r.verdict === 'keep' && !['outside-wt', 'inner', '20-prunable'].includes(r.slug)).every((r) => existsSync(wtPath(r.slug))));

  // ------------------------------------------------------------ SKILL.md
  log('\n=== SKILL.md states what this procedure does ===');
  const skillDir = path.join(REPO, '.claude', 'skills', 'clean-worktrees');
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const frontmatter = Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? '').split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  check('frontmatter name matches the folder', frontmatter.name === path.basename(skillDir));
  check('frontmatter has description and argument-hint', frontmatter.description?.length > 40 && frontmatter['argument-hint'] === '[age-days]');
  check('the skill cannot be auto-invoked by the model', frontmatter['disable-model-invocation'] === 'true');
  check('the skill states the default and the argument pattern', skill.includes(`Default \`${DEFAULT_AGE_DAYS}\``) && skill.includes(AGE_ARGUMENT_PATTERN.source));
  check('the skill prescribes the gh commands the procedure runs', skill.includes(GH_COMMANDS.prList) && skill.includes(GH_COMMANDS.issueView));
  check('the skill states the name, commit, number and ROOT patterns the procedure enforces', [SLUG_PATTERN, BRANCH_PATTERN, COMMIT_PATTERN, NUMBER_PATTERN, TICKET_PATTERN].every((p) => skill.includes(p.source)) && skill.includes('[A-Za-z0-9._/ -]'));
  check('the skill states the age comparison the procedure uses', skill.includes('age_days >= AGE_DAYS'));
  const step3 = skill.slice(skill.indexOf('Decide `keep` in this order'), skill.indexOf('For the rest, record'));
  const positions = KEEP_ORDER.map((reason) => step3.indexOf(`keep: ${reason}`));
  check('the skill lists the step 3 keep reasons in the order the procedure applies them', positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), positions.join(','));
  check('the skill states the could-not-verify and unknown-state outcomes', skill.includes('keep: could not verify') && skill.includes('keep: unknown <PR|ticket> state'));
  check('the skill runs the ancestor check in ROOT against the worktree head sha and re-checks HEAD in step 8', skill.includes('git -C "$ROOT" merge-base --is-ancestor "$head_sha" "$oid"') && skill.includes('`HEAD` still equal to `$head_sha`'));
  check('the skill forbids --force, branch deletion and killing processes', skill.includes('Never `--force`, never delete a branch, never kill a process'));
} finally {
  cleanup();
}

const ok = summarize(results);
output.push('', ok ? `ALL ${results.length} CHECKS PASSED` : 'SOME CHECKS FAILED');
writeProof('01-fixture.txt', `# ${new Date().toISOString()}  node ${process.version}\n` + output.join('\n').replace(/pid \d+/g, 'pid N') + '\n', { [tmp]: '<tmp>' });
process.exit(ok ? 0 : 1);

function FAKE_GH() {
  return `#!/usr/bin/env node
// Fake gh for the clean-worktrees verification. Answers from GH_FAKE_DATA and records every call.
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.env.GH_FAKE_DATA, 'utf8'));
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.GH_FAKE_LOG, argv.join(' ') + '\\n');
const [a, b, ...rest] = argv;
function fail(msg) { process.stderr.write(msg + '\\n'); process.exit(1); }
if (a === 'auth' && b === 'status') process.exit(0);
if (a === 'pr' && b === 'list') {
  const head = rest.find((x) => x.startsWith('--head='));
  if (!head || rest.indexOf('--state') < 0 || rest[rest.indexOf('--state') + 1] !== 'all' || rest.indexOf('--json') < 0) fail('fake gh: pr list needs --head=, --state all and --json');
  const fields = rest[rest.indexOf('--json') + 1].split(',');
  const entry = data.prs[head.slice(7)] ?? [];
  if (entry.error) fail(entry.error);
  if (entry.raw !== undefined) { process.stdout.write(entry.raw); process.exit(0); }
  process.stdout.write(JSON.stringify(entry.map((p) => Object.fromEntries(fields.map((f) => [f, f === 'isCrossRepository' ? (p[f] ?? false) : p[f]])))));
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
fail('fake gh: unsupported ' + argv.join(' '));
`;
}
