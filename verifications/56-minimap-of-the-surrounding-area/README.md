# Verification of ticket #56: minimap of the surrounding area

What is verified, from the player's side: a minimap in the corner shows the terrain around the local player, drawn from the world's own data; it follows the player; it marks the local player, every other player and the starting point so that they are told apart; from far away the starting point's marker sits on the edge and points home; it works solo and online; it is readable at every camera zoom and does not cover the HUD lines; and it costs the same on a map a hundred times the world's size.

Run everything (the first run installs Playwright and pngjs in this folder):

```bash
bash verifications/56-minimap-of-the-surrounding-area/run.sh
```

The scripts start their own servers on ports 5961 to 5967 and stop them. Expected positions, colours and counts come from `window.__novaland` (`minimap()`, `tiles`, `defs`, `map`, `camera()`). What is typed into the scripts is the scenario: window sizes, how long a key is held, the generated map's size, and the names of the world's tile kinds a place is expected to show. Terrain is checked on the screen itself: for every tile the minimap shows, the pixel in the middle of the tile's square in a screenshot must be the colour of the def the map has at that tile.

| Script | What it proves | Proof |
|---|---|---|
| `01-check.mjs` | `pnpm install`, `typecheck`, `lint`, `build` and `test` pass, and the headless tests the ticket relies on pass by name: markers come from def data, tiles are painted in their def's colour (a tile kind the minimap never heard of included), far things go to the edge, a bounded number of chunks is kept on any map, the HUD lines are never covered | `proof/01-check.txt`, `01-check.json`, `01-tests.json`, `01-check-output.txt` |
| `02-solo.mjs` | Solo on the world: where the minimap is, that it reaches further than the screen, every tile compared against the map at three places, walking moves it by as many tiles, the three kinds of marker, and the same at camera zooms 1, 2, 4 and 6, at a pixel ratio of 2, in a narrow window, and on a live page taken from 1x to 2x | `proof/02-solo.txt`, `02-solo.json`, `02-solo-*.png` |
| `03-big-map.mjs` | Solo on the generated 400x300 map: the starting point's marker in range, then on the edge pointing home after walking out of reach and round a corner; every tile compared far from the start; chunks painted stay a handful of 130 and standing still paints nothing | `proof/03-big-map.txt`, `03-big-map.json`, `03-big-map-*.png` |
| `04-online.mjs` | Two browsers on the real room server: each sees the other's dot where the other is, the minimap is centred on the predicted position the player sees, and one's dot moves on the other's minimap as it walks | `proof/04-online.txt`, `04-online.json`, `04-online-*.png` |
| `05-frame-time.mjs` | Frame time with the minimap on, uncapped, five rounds on each map taking turns: the walk on the big map brings new chunks under the minimap, and still its frame time (median and 95th percentile) is within the noise of the world's, and the minimap's own per-frame call takes the same few microseconds on both | `proof/05-frame-time.txt`, `05-frame-time.json`, `05-frame-time-*.png` |

Each `*.png` has a `*-minimap.png` next to it: the minimap alone, four times larger.

`05-frame-time.mjs` measures time, so its numbers move with the machine and what else runs on it; the comparison is between the two maps in the same run, never against a fixed number.

`05-frame-time.mjs` times the minimap's per-frame call by wrapping `Minimap.show` on the HUD scene from the page, and `browser.mjs` reads the HUD lines' box from the scene's text object: both reach past `window.__novaland`, into things only a check needs.
