# Verifications for #1 - Bootstrap monorepo

Ticket: https://github.com/juliogarciag/novaland/issues/1

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/1-bootstrap-monorepo/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless N-tick movement test and the determinism test exist and pass | `proof/01-check.log` |
| 02 | `02-boundaries.mjs` | Lint rejects every boundary violation: Phaser/DOM/server in sim, Rapier/bitECS/deep sim imports in client, Phaser in server, relative imports across packages, `Math.random`/`Date` in sim. The violation files are written, linted and removed. | `proof/02-boundaries.json` |
| 03 | `03-headless.mjs` | The server package runs the same sim headlessly (`pnpm sim:headless`), the player moves, and two runs give the same state hash | `proof/03-headless.json` |
| 04 | `04-ports.mjs` | No hardcoded ports: two dev servers run side by side pinned by `PORT`, and an unpinned one picks a free port (multi-worktree use) | `proof/04-ports.json` |
| 05 | `05-browser.mjs` | The slice in a real browser (Playwright + Chromium): Phaser canvas renders, real key presses move the player at the def speed, a wall stops it, it slides along walls, the border holds, and the drawn circle sits where the sim says | `proof/05-browser-*.png`, `proof/05-browser.json` |
| 06 | `06-agents-md.mjs` | `AGENTS.md` carries the process, the layout, the rules, the four commands and a step-by-step guide to adding a feature | `proof/06-agents-md.json` |

The console output of each run is also kept as `proof/<script>.txt`.
