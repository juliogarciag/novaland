# Verifications for #36: tree art

Run everything with `bash verifications/36-tree-art/run.sh`. The first run installs Playwright and pngjs into this folder (it is not part of the workspace).

| Script | What it proves | Proof |
| --- | --- | --- |
| `01-check.mjs` | `pnpm install`, `test`, `typecheck` and `lint` pass; the tests this ticket adds ran; the determinism test passes; `pnpm sim:headless` ends on the same state hash as before the ticket (`50b21d74`), so the sim did not change. | `proof/01-check.txt`, `proof/01-check-output.txt`, `proof/01-tests.json` |
| `02-sheet.mjs` | `public/sprites/tree.png` is byte for byte what `tools/generate-tree-sheet.mjs` writes and matches the tree's `standingSprite`; every variant has a trunk inside the tile and a canopy that overhangs it to the north and to both sides; the variants differ. | `proof/02-sheet.txt`, `proof/02-sheet.json`, `proof/02-sheet-contact.png` (drawn by the script from the sheet, not by the game) |
| `03-browser.mjs` | In Chromium against `pnpm dev`: one tree image per tree tile on grass; the player walks in front of, beside and behind a clump of trees and at each stop both the Phaser display list and the pixels of a screenshot agree with "sorted by bottom edge"; the sim still stops the player at the tile's faces; trees are crisp at 2x, 3x and 6x zoom; with the sheet blocked, trees fall back to flat tiles and nothing throws. | `proof/03-browser.txt`, `proof/03-browser.json`, `proof/03-browser-*.png` |

Screenshots of the game:

- `03-browser-1-forest-edge-at-spawn.png`: the forest edge, a group of trees.
- `03-browser-2-in-front*.png`, `03-browser-3-beside*.png`, `03-browser-4-behind*.png`: the player south, west and north of a 2x2 clump.
- `03-browser-5-tree-at-the-forest-edge*.png`: a tree that sticks out of the forest with open ground on three sides.
- `03-browser-6-zoom-*.png`: the same view at three whole-number zooms.
- `03-browser-7-without-the-sheet.png`: the fallback when `tree.png` cannot be loaded (what trees looked like before).

The starter level has no tree with open ground all around it (`freeStandingSingleTrees: 0` in `03-browser.json`), and this ticket may not change the level. Single trees are shown by the contact sheet and by the tree at the forest edge.
