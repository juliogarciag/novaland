# Verifications for #42: rock and grass art, no paths

Run everything with `bash verifications/42-rock-and-grass-art-no-paths/run.sh`. The first run installs Playwright and pngjs into this folder (it is not part of the workspace).

| Script | What it proves | Proof |
| --- | --- | --- |
| `01-check.mjs` | `pnpm install`, `test`, `typecheck` and `lint` pass; the tests this ticket adds ran; rocks are still solid, grass still walkable, def ids unchanged; the determinism test passes and two headless runs end on the same state hash. That hash is no longer `50b21d74`: the level's colliders changed (two trees where the path left the clearing). | `proof/01-check.txt`, `proof/01-check-output.txt`, `proof/01-tests.json` |
| `02-sheets.mjs` | `rock.png`, `grass.png` and `tree.png` are byte for byte what their generators write (the tree's generator now shares its pixel canvas with the other two). Every rock variant is a grey lump with a dark edge, sunk into the ground (its lowest row is grass in the grass sheet's greens, no shadow), and they differ. Every grass tile is opaque and textured all over but calmly (no 6x6 patch of any tile is one flat colour, between a tenth and a third of each tile is blades, every green within 32/255 of the turf), the tiles differ, and flowers are on 2 of 24. | `proof/02-sheets.txt`, `proof/02-sheets.json`, `proof/02-sheets-contact.png` (drawn by the script from the sheets, not by the game) |
| `03-browser.mjs` | In Chromium against `pnpm dev`, read through `window.__novaland`: the level has no dirt tile, its edge is all trees, and walking from the spawn reaches every walkable tile and never the edge. The ground tileset holds the served grass sheet pixel for pixel; every grass, tree and rock tile shows one of its tiles; neighbours rarely match. On screen, every grass tile in view is exactly the sheet tile the layer names and every rock the rock sheet's pixels, in flat blocks at 2x, 3x and 6x zoom. One rock image per rock tile, sorted by its bottom edge; the sim still stops the player at the rock's faces and the player is drawn over it from the south. A second page and a reload draw the same variants. With both sheets blocked, tiles fall back to flat colours and nothing throws. | `proof/03-browser.txt`, `proof/03-browser.json`, `proof/03-browser-*.png` |

Screenshots of the game:

- `03-browser-1-at-spawn.png`: the clearing at the spawn: textured grass, rocks, the forest edge, no path.
- `03-browser-2-in-front-of-a-rock*.png`, `03-browser-3-behind-a-rock*.png`: the player south and north of a rock.
- `03-browser-4-where-the-paths-crossed.png`: the middle of the level, where the two main paths used to cross.
- `03-browser-5-zoom-*.png`: the same view at three whole-number zooms.
- `03-browser-6-without-the-sheets.png`: the fallback when `grass.png` and `rock.png` cannot be loaded (what the ground and the rocks looked like before).

`verifications/36-tree-art/` is not rerun here. Two of its expectations describe the game before this ticket: that the headless state hash is `50b21d74`, and that a def's ground tile index is its position in `terrainDefs`.
