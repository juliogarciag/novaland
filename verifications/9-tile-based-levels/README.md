# Verifications for #9 - Tile-based levels with a forest border and paths

Ticket: https://github.com/juliogarciag/novaland/issues/9

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/9-tile-based-levels/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless tests for collider merging, trees and rocks blocking the player, walking on paths, the dirt spawn tile, colliders not being drawn, and determinism exist and pass | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-headless.mjs` | `pnpm sim:headless` still runs the tile level without a browser: the scripted walk from the spawn is unblocked and ends on a walkable tile, and two processes give the same hash | `proof/02-headless.json` |
| 03 | `03-browser.mjs` | The level in a real browser (Playwright + Chromium): a Phaser tilemap with one cell per tile whose indices match the sim grid cell for cell, 16x16 generated placeholder tiles, trees on every edge, grass/dirt/rocks inside; the player spawns on a dirt tile (and the tile drawn under it is dirt), walks east along the path at the def speed with real key presses, and walking north stops at the face of the first tree the grid says is there; the drawn circle sits where the sim says; the camera from #8 is bounded by the tile grid, zooms by a whole number, keeps the player on screen, shows the forest border where it is clamped at the spawn and travels with the walk | `proof/03-browser-*.png`, `proof/03-browser.json` |

The console output of each run is also kept as `proof/<script>.txt`.
