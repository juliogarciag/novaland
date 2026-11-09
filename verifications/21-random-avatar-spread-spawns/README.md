# Verifications for #21 - Random avatar on join, spread spawns, players pass through each other

Ticket: https://github.com/juliogarciag/novaland/issues/21

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/21-random-avatar-spread-spawns/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless tests this ticket adds ran and passed: avatars are picked deterministically per seed and differ between seeds, never duplicated while an unworn one is left, fall back once all are worn, freed on leave, and an avatar field in the join is ignored; five joins land on five distinct walkable tiles next to the spawn, spread on both axes, skipping solid and taken tiles, reusing freed ones and never throwing when none is free; two players walking at each other cross at full speed, a standing player blocks nobody and terrain still stops the walker; the client's seat picking never queues two joins for one seat; `core/determinism.test.ts` and every pre-existing test still pass | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-sheets.mjs` | The player defs declare at least 8 avatars with distinct sprite keys; `packages/client/tools/generate-player-sheet.mjs` has one palette per avatar under the same keys; a sheet is committed under `packages/client/public/sprites/` for every key and is pixel-identical to a fresh run of the generator; every sheet is 4x4 frames of the 16x24 layout the defs declare, with every frame drawn, all 16 frames distinct and a clear edge; the sheets are pairwise different pictures with an identical silhouette (same character, other palette) | `proof/02-sheets.json` |
| 03 | `03-browser.mjs` | In Chromium (Playwright) against `pnpm dev`: every avatar sheet is served and loaded with its four walk animations; the local player joined seat 0 wearing an avatar the sim picked, on the spawn tile, drawn from that avatar's sheet, and the HUD names it; seating four more players (`window.__novaland.joinAnotherSeat()`, the dev-only hook that queues plain `player/join` commands, no avatar field) gives five players in slots 0-4 with five different avatars on five different walkable tiles touching the spawn tile, spread on both axes, each at its tile centre and drawn from its own sheet, HUD `players: 5`; holding a movement key walks the local player straight through a neighbour on its line, well past it, without slowing, deflecting or pushing the neighbour; holding on into the forest stops it against the first tree face (terrain still blocks) while nobody else moved; pressing the dev `J` key seats a sixth player; whole-number zoom; no console errors | `proof/03-browser-*.png`, `proof/03-browser.json` |

The console output of each run is also kept as `proof/<script>.txt`.
