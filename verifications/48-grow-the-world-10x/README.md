# Verifications for #48 - Grow the world 10x

Ticket: https://github.com/juliogarciag/novaland/issues/48. Stacked on #47 (world as chunks, [ADR 0013](../../docs/decisions/0013-world-as-chunks.md)).

The ticket's user is a player: the world they spawn into is ten times bigger, all of it can be walked to, and walking across it feels like walking across the old clearing did. So the proof is a test that every walkable tile is within reach, a measurement of what the bigger world costs next to the old one, and a walk in a real browser from the spawn through every area to the far corner, solo and online.

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/48-grow-the-world-10x/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install`, `typecheck`, `lint`, `build` and `test` pass, and the headless tests the ticket asks for pass by name: **every walkable tile of every area is reached from the spawn** stepping up, down, left and right (and every avatar is narrower than a tile, so a way a tile wide is a way a player fits through); the nine areas cover their rectangle with no hole; the world is 130x92 tiles, 9.97 times the clearing, with the clearing at the origin and the spawn on (6, 14) as before; trees close the outer edge; there is still no dirt. Nothing under `packages/sim/src/core` changed, nor the area format | `proof/01-check.txt`, `proof/01-check.json`, `proof/01-tests.json`, `proof/01-check-output.txt` |
| 02 | `02-measure.mjs` (runs `measure.mts`) | Five players walking on the 40x30 world from before this ticket (`baseline/world-before.json`) and on the world now, measured in turns in one process, nine rounds each. **Full-state size** and delta size: the same (the five players). **Per-send cost**: the same within noise. **Tick cost: not the same**, see below | `proof/02-measure.txt`, `proof/02-measure.json` |
| 03 | `03-walk.mjs` (with `walker.mjs`) | In Chromium, solo and online against the real room server, with `player/move` commands only: a picture of the whole world; **solo, a walk of 538 m from the spawn through all nine areas**, the far corner included, with a screenshot standing in each; **online, a walk from the spawn to the far corner** (tile (80, 57), 86 tiles from the spawn in a straight line), still seated and drawn where the server has the player. No hitch: the player kept walking speed over every leg, every chunk the camera showed was drawn in every frame, never more than 7 of the 15 chunks at once, and the game's own work per frame (update and render) stayed about 1 ms, the same as in the old clearing, the frames that built or dropped chunks included | `proof/03-walk.txt`, `proof/03-walk.json`, `proof/03-whole-world.png`, `proof/03-solo-*.png`, `proof/03-online-*.png` |

## What is not met: tick cost

The ticket asks for tick cost "the same within noise" as the 40x30 world. It is about four times higher: around 0.02 ms a tick before, around 0.08 ms now (`proof/02-measure.json` has the rounds). `02-measure.mjs` keeps that check as the ticket words it, so **it fails, and `run.sh` ends with "SOME VERIFICATIONS FAILED"** for that one line. Everything else passes.

Why: the physics step costs time for every terrain collider in the world, moving or not. A sim with no player at all takes 0.012 ms a tick with the old world's 45 boxes and 0.074 ms with this world's 575 or so. #47's own measurement shows the same slope (0.42 ms on its 400x300 map). That is how the sim's core steps physics; this ticket is content only and may not change it, and no layout of trees ten times the size gets back to 45 boxes.

What it means in play: a tick has 16.7 ms, and 0.08 ms is half a percent of it. The second check in the script, "one tick still takes under 1% of the time a tick has", passes. The walk in `03` shows no cost a player could see. The cost is real for worlds much bigger than this one, and is ticket #58.

## What is measured, and what is not

- **Frames are timed twice.** From the frame before (what the screen shows) and the game's own work in the frame (the scene's update plus Phaser's render call). Headless Chromium on a machine that is running other things now and then presents a frame late: a handful of frames in a thousand came 50 ms or more after the one before, each with about 1 ms of game work in it, in the old clearing as well as in the new land. The script counts them, fails if there are more than one in a hundred or if any had real game work in it, and the report lists the numbers. Work the graphics card does after the render call is not in the game's number; software rendering in headless Chromium is the worst case for it and the frames that built chunks were not the late ones.
- **Online, the walker steers by where the player is drawn** (the prediction), as a person does, and reads the server's position for the checks. Its turns reach the server a tick or two apart from where the page applied them, which gives small corrections (the largest about 0.3 m, under the 0.5 m that six ticks of walking come to, the bound the prediction's own jitter test uses). That the page and the server hold the same ground is not inferred from that: the page is only seated if its map checksum equals the server's.
- **The walker plans its own route** over the walkable tiles it reads from the debug API, preferring the middle of trails. It proves the places are reachable by a body with the player's radius under real physics, on top of the tile-by-tile test in `01`. It does not prove every tile is: the test does.
- **"Before" is the clearing as it was**, ring closed, copied into `baseline/world-before.json` from commit `81ffa8b`. The clearing in the world now has four exits cut in its ring; nothing else in it changed.
- **Trails are grass**, not dirt. #42 took the dirt paths out on purpose and a test still says the world has none, so "paths that lead somewhere" are ways cut through the forest.
