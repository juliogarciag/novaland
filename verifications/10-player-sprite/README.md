# Verifications for #10 - Player sprite with a four-direction walk animation

Ticket: https://github.com/juliogarciag/novaland/issues/10

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/10-player-sprite/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless `Facing` tests (spawn facing down, follows the move intent, persists after a stop, unit length, malformed input ignored, in the snapshot, reset on entity id reuse, no heading for non-players), the client pose tests and the determinism test all ran and passed | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-sheet.mjs` | The committed `packages/client/public/sprites/player.png` is pixel-identical to a fresh run of `packages/client/tools/generate-player-sheet.mjs`; it is 4 columns x 4 rows of the 16x24 frames the player def declares; every idle frame and walk range of the def exists; each direction has its own row; all 16 frames are drawn, pairwise distinct and keep a transparent edge | `proof/02-sheet.json` |
| 03 | `03-browser.mjs` | In Chromium (Playwright) against `pnpm dev`: the sheet is served and loaded as a 16-frame texture with four walk animations, drawn with nearest-neighbour filtering; the player is one sprite from it, scaled by the client's pixels per metre and anchored at the def's origin, while walls still draw as rectangles (fallback); holding D, S, A and W plays that direction's walk cycle and the frame visibly changes within the direction's row; releasing leaves that direction's idle frame and the sim's `Facing` is the unit vector of the last move, still there half a second later; the sprite tracks the sim position; every object's depth is its bottom edge; the level camera (ticket #8) zooms by a whole number and keeps the sprite in the middle of the screen while scrolling on both axes; standing south of the inner 2x2 block the sprite overlaps it and draws in front (visible in the zoomed screenshot), standing north of it draws behind (proved by the depth numbers in `03-browser.json`: the flat block is not tall enough for the sprite to overlap it from the north); no console errors | `proof/03-browser-*.png`, `proof/03-browser.json` |

The console output of each run is also kept as `proof/<script>.txt`.
