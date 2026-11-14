# Verifications for #47 - World as chunks

Ticket: https://github.com/juliogarciag/novaland/issues/47. Decision: [ADR 0013](../../docs/decisions/0013-world-as-chunks.md).

The ticket has two users. A player, who must notice nothing: the same map, the same collisions, the same spawn, solo and online. And whoever grows the world next, who needs the ground to stop costing per send, coordinates that do not move, and areas that mount where they say. So the proof is a comparison with the code before the change, plus measurements on a generated map a hundred times the world's size.

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/47-world-as-chunks/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install`, `typecheck`, `lint`, `build` and `test` pass, and the headless tests the ticket asks for exist and pass by name. **Growing**: areas added on all four sides leave every tile, the spawn and every collider where they were, and the same commands walk players to the same positions bit for bit. **Mounting**: a second area at reserved coordinates has its tiles and colliders there, in the same physics world, and stops a player; an overlap of even one tile is refused. **Terrain out of state**: no entity, nothing in world state, same boxes and physics bytes every time, a wall across a chunk edge is solid at the seam. **Prediction**: it builds the same colliders as the server, takes no entity id for terrain (so the server's id 1 is free to adopt), and walks into walls as the server does. **Wire**: protocol 3, the welcome names the map, a page with another map is refused | `proof/01-check.txt`, `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-same-ground.mjs` (runs `same-ground.test.ts`) | Against `baseline/ground.json` and `baseline/walk.json`, recorded on the old code: all 1,200 tiles are the same tile at the same coordinate; the spawn is the same tile and point; the boxes really in the physics world cover exactly the solid tiles the old collider entities covered, each once; five players pushed around for 40 seconds, 194 samples of them pressed against trees and rocks, end within 3 mm of where they did before | `proof/02-same-ground.txt`, `proof/02-same-ground.json` |
| 03 | `03-measure.mjs` (runs `measure.mts`) | The ticket's table measured again, before and now (on this folder's own generated map, so the "before" figures are 38 and 3,314 entities where the ticket's map gave 49 and 3,766; same shape, same conclusion), on generated 40x30 and 400x300 maps with five players walking: world-state entities 5 on both (before 38 and 3,314), build-and-diff per send about 0.02 ms on both (before 0.09 and 6 ms), full state about 1.4 KB on both (before 7.6 and 651 KB), and the 400x300 map boots at the default capacity | `proof/03-measure.txt`, `proof/03-measure.json` |
| 04 | `04-same-look.mjs` | In Chromium, solo and online against the real room server: the whole map, terrain only, is **pixel for pixel** the picture the old code drew (`baseline/before-*-terrain.png`); the player appears on the spawn tile; walking north, the first tree stops it at its face; the terrain on screen is chunks | `proof/04-same-look.txt`, `proof/04-same-look.json`, `proof/04-after-*.png` |
| 05 | `05-prediction.mjs` | Online with prediction on and 300 ms of round trip (`slow-link.mjs` between browser and server): the local player, entity id 1, walks 1.7 m ahead of the server's state into the forest, is never drawn past the tree's face, is never moved back, and hitting the tree adds no correction at all; at rest it is drawn exactly where the server has it. The replica holds one entity: no terrain came over the wire | `proof/05-prediction.txt`, `proof/05-prediction.json`, `proof/05-prediction-pushing-into-tree.png` |
| 06 | `06-big-map.mjs` | In Chromium on a generated 400x300 map (`VITE_GENERATED_MAP`, 130 chunks, 6,273 trees and rocks) next to the world itself: 4 of 130 chunks are drawn, 126 standing images against the world's 358; ten seconds of walking changes which chunks are drawn and never raises the count past 6; zoomed out to three times the view more chunks are drawn; and at every sample every pixel of the screen is terrain, so nothing near the camera was left out | `proof/06-big-map.txt`, `proof/06-big-map.json`, `proof/06-big-map-*.png` |

## The baseline

`baseline/` was recorded on commit `0436845` (this branch before any change to the game) by `baseline/capture-sim.ts` and `baseline/capture-browser.mjs`. Those two scripts cannot run on the new code, since they read levels, `readTileGrid` and `TerrainCollider` entities; they are kept as the record of how the numbers and pictures were made. `generated-rows.mjs` is shared by both sides, so the old and the new code are measured on the same generated ground and the same scripted walk.

## What is not exact, and why

- **Positions agree to millimetres, not bits.** The same place is now 20 m east and 15 m south of the origin in metres (the origin moved from the map's centre to its top-left corner, once). Rapier keeps positions as 32-bit floats, so each step rounds differently in the last bits. Tiles, colliders and pixels are compared exactly. Between two maps of the *new* code (the world, and the world with areas added around it) the walk is bit for bit, which is the property that has to hold from now on.
- **45 boxes cover what 43 entities did.** Rectangles are merged inside a chunk only, so the two that cross column 32 are cut there. The check is on the ground covered, tile by tile. The cut is not perfectly smooth: a player sliding diagonally along the top or bottom border is pushed about 4 mm off the wall on the tick it crosses column 32 and settles back within six ticks (ADR 0013). That is a sixteenth of a pixel and the one place where collisions differ from before.
- **Snapshots still grow with the map** (24 ms to snapshot and hash at 400x300, from 85 ms): the physics bytes hold the colliders. The ticket asks for send cost, join size and entity capacity; those no longer do.
- **The room server itself was not run on the 400x300 map**: it always runs the world. Per-send cost is measured on the two calls its send does (`worldState`, `diffWorldState`), on a sim of that map.
