---
name: clean-worktrees
description: Remove git worktrees under .worktrees/ whose ticket and PR are finished, after one confirmation.
argument-hint: [age-days]
---

Clean unused git worktrees of this repository. Worktrees live under `.worktrees/` and are named `{ticketNumber}-{ticketKebabTitle}` (see AGENTS.md), so the ticket number is the start of the branch name.

# Args

`$1` (optional): age threshold in days for worktrees with no trackers. Default `7`.

# Rule (the only one)

A worktree is **unused** if either:

- It has **no trackers** (no PR, no ticket) AND its HEAD commit is older than `AGE_DAYS` days, OR
- It has **one or more trackers** AND **every** existing tracker is in a terminal state.

Terminal states:

- **PR**: `CLOSED` or `MERGED` (`gh` state values).
- **Ticket** (GitHub issue): `CLOSED`.

# Procedure

1. Parse `$1` into `AGE_DAYS` (default `7`). Compute the cutoff timestamp once.

2. Find the repository root with `git rev-parse --show-toplevel`. If the current directory is itself inside `.worktrees/`, the root is the main checkout: strip everything from `/.worktrees/` onwards. Call it `ROOT`.

3. Run `git -C ROOT worktree list --porcelain`. For each worktree block, skip when:
   - It is the **main worktree** (its path equals `ROOT`).
   - The block contains a `locked` line.
   - The block contains a `bare` line.
   - Its path is the **current working directory** or a parent of it. Report it as `keep: current session`, because removing it would pull the floor out from under this session.

   For each remaining worktree, gather:
   - `path`: absolute worktree path.
   - `slug`: the directory name under `.worktrees/`.
   - `branch`: `git -C <path> rev-parse --abbrev-ref HEAD`. Skip detached HEADs and report them as `keep: detached`.
   - `last_commit_ts`: `git -C <path> log -1 --format=%ct HEAD`.

4. For each candidate, discover trackers:
   - **PR**: run `gh pr list --head <branch> --state all --json number,state,url --limit 1` from `ROOT`. A non-empty result means the worktree has a PR with the returned `state`.
   - **Ticket**: extract `^(\d+)-` from `branch`. If it matches, run `gh issue view <number> --json state,title` from `ROOT`. If the extraction fails, the worktree has no ticket. If the fetch fails (issue not found, network error), treat it as no ticket and say so in the reason.

5. Apply the rule. Build a reason string for each worktree, for example:
   - `unused: PR merged (#3), ticket closed (#1)`
   - `unused: PR closed (#12)`
   - `unused: no trackers, last commit 12d ago`
   - `keep: PR open (#12)`
   - `keep: ticket open (#9), no PR yet`
   - `keep: no trackers, last commit 3d ago (< 7d)`

6. Print a preview:

```
REMOVE  .worktrees/<slug>  branch=<branch>  — <reason>
keep    .worktrees/<slug>  branch=<branch>  — <reason>
```

End with a one-line summary: `N to remove, M to keep`. If nothing is removable, say so and stop.

7. Ask the user **once** to confirm the batch, not per worktree: `Remove the N worktrees above? [y/N]`.

8. On confirmation, for each REMOVE:
   - Check for a dev server still running from it: `lsof -nP +D <path> 2>/dev/null | head -1` or a `node` process whose cwd is under `<path>`. If one is found, report `skipped: <slug> has a running process (pid N)` and continue. Do not kill it.
   - Run `git -C ROOT worktree remove .worktrees/<slug>`.
   - If it fails (local changes, lock), report the error inline and continue with the next one. Do not pass `--force`.
   - Print `removed: .worktrees/<slug>  (branch=<branch>)` on success so the user can recover with `git worktree add` if needed.

9. Final summary: `Removed X, skipped Y, failed Z, kept W.`

# Notes

- Do **not** delete local branches. The branch stays so the work is recoverable; prune branches separately.
- Do **not** pass `--force` to `git worktree remove`. If a worktree has uncommitted work, the failure surfaces it and the user decides.
- Each worktree has its own `node_modules`, so removing one frees real disk space. That is the main reason to run this.
- Ticket numbers come from the branch name only. A branch that does not start with a number has no ticket, even if its PR body says `closes #N`.
