# Proof for #37 - Freeze verifications at merge

Ticket: https://github.com/juliogarciag/novaland/issues/37. Small: docs, a root `.ignore` and the template under `verifications/_template/`, so this folder holds only the proof of running the change once.

| Proof | What it shows |
|---|---|
| `proof/search-transcript.txt` | With ripgrep 14.1.1 (the build bundled with Claude Code, which this app's search runs): before the root `.ignore`, a repo-wide content search lands in every ticket's folder; after it, only `verifications/_template/` is returned, also with hidden files on and from a subdirectory. Naming a folder still searches it (relative, absolute, from inside, and this ticket's own in-progress folder) and reading a file by path still works. What `.ignore` does not cover is shown too: `rg --no-ignore-dot`, `git grep`, and file listing with `--no-ignore`, which is how the agent Glob tool runs unless `CLAUDE_CODE_GLOB_NO_IGNORE=false`. The 277 tracked files of the frozen folders are all still there |
| `proof/template-run/` | The template run once from a copy, as its README says to start a ticket (`cp -R verifications/_template verifications/37-template-copy-check`, then `bash verifications/37-template-copy-check/run.sh`): `solo.txt` and `online.txt` are the console output (4 of 4 checks each), `solo.json` and `online.json` the reports, the PNGs the screenshots. The copy was removed afterwards |
| `proof/check.txt` | `pnpm check` (tests, typecheck, lint) on the branch |
