# 43: Add a PR template

Small ticket, so this folder holds only the proof of running the change once.

`proof/transcript.txt` has two parts:

1. What `gh pr create` offers while `.github/pull_request_template.md` is only on the ticket's branch. It offers nothing: `gh` 2.36.0 asks GitHub for the repository's templates and GitHub reads them from the default branch. The transcript shows the interactive run, GitHub's answer for this repo, and the same question answered for a public repo that has a template on its `main`.
2. The body of this ticket's own PR against the template: the same lines in the same order, no comment or placeholder left, no empty section, the attribution last.

The transcript is the output of the commands it shows, run from the worktree with `gh` 2.36.0 after the PR was opened. The interactive `gh pr create` was driven by `expect` and cancelled at the last prompt, with `GH_EDITOR` set to a script that saves the body `gh` hands to the editor.
