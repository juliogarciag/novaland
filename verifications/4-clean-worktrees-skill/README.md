# Verification: clean-worktrees skill (ticket #4)

The skill is a procedure an agent follows, so `procedure.mjs` implements it step for step and the verifications drive that implementation. `01-fixture.mjs` also checks that `SKILL.md` prescribes the same commands, name patterns and keep reasons, so the two cannot drift silently.

- `01-fixture.mjs`: builds a throwaway repository in the system temp dir with eighteen worktrees and a fake `gh` on `PATH`, then checks every branch of the rule (merged, closed, mixed, no PR, cross-repository PR, ticket number that is a PR, old and fresh untracked, fresh worktree on an old base), every keep reason of step 3 (locked, detached, outside `.worktrees/`, unusual name, default branch, current session, uncommitted changes, running process), lookup failures for both PR and ticket, argument validation, the preview format and ordering, and a real removal where one worktree is dirtied and one locked after the preview. Nothing outside the temp dir is touched and it is deleted afterwards.
- `02-live.mjs`: the same procedure against this repository with the real `gh`, preview only. Checks that depend on worktrees that may be gone later are reported as `SKIP`.
- `proof/`: output of the last run, with machine-specific paths replaced.

Run `bash verifications/4-clean-worktrees-skill/run.sh` from anywhere. It needs `git`, `gh` (authenticated, for `02-live`) and `lsof`.
