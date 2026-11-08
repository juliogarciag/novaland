# Verification: clean-worktrees skill

The skill is a procedure for an agent, so the verification runs the same commands the procedure prescribes against this repository and checks that each step produces what the skill expects.

- `01-procedure.mjs`: resolves `ROOT` from inside a worktree, lists worktrees with `--porcelain`, parses blocks, resolves branch and last-commit timestamp, discovers the PR and ticket for each branch with `gh`, applies the rule, and prints the preview. It asserts that the merged bootstrap worktree (`1-bootstrap-monorepo`, PR #3 merged, ticket #1 closed) is classified `REMOVE` and that the worktree of ticket #4 (open) is `keep`. It never removes anything.
- `proof/01-procedure.txt`: the output of the last run.

Run with `node verifications/4-clean-worktrees-skill/01-procedure.mjs` from any checkout of the repo.
