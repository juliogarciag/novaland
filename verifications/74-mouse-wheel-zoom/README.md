# 74 - Mouse wheel zoom

Proof that, in a dev build, the mouse wheel zooms the world out until the whole map is on screen and back in to the normal view, that it stays a view fact, and what it costs.

## Run it

```bash
bash verifications/74-mouse-wheel-zoom/run.sh
```

It starts its own dev servers (ports 5974 to 5976) and drives Chromium on this machine's graphics card (`--use-angle=metal`), in a 1440x900 window at a pixel ratio of 2. On a machine without one the frame rate is written down and not judged.

| Script | What it proves | Proof |
|---|---|---|
| `01-zoom.mjs` | On three maps (the Alps region of #70, the world, a generated 400x300 map with trees): the page opens at the normal whole-number zoom; each turn of the wheel down is one level further out and shows more; the camera stays on the player; every chunk the view touches is drawn, as art down to a zoom of 1/2 and as colours below; at the furthest zoom the whole map is on screen, in the middle of the window, every chunk drawn, tiles sampled all over it in the right place and colour, at 50 frames a second or more; a further turn changes nothing; after all those turns the local player's components in the sim are byte for byte what they were; zoomed out the player still walks and the camera follows; the wheel up returns to the normal view with only the chunks near it alive; no page errors | `proof/01-zoom.json`, `proof/01-zoom.txt`, `proof/<map>-<step>-zoom-<zoom>.png` |
| `measure.mjs` (not a check; `node measure.mjs <url> <proof file>` against a running dev server) | What each level costs on the region map: the longest frame after the step and the frame rate once settled | `proof/measure-1440x900-at-2x.json`, `proof/measure-1920x1080-at-1x.json`, and `proof/baseline-tilemaps-1440x900-at-2x.json`: the same before the far view was drawn as colours (15 frames a second at 1/4, 9 with the whole map on screen) |

The unit tests next to the code cover the rules themselves: `render/zoom.test.ts` (the levels), `input/wheel.test.ts` (a notch is a step, a swipe is not dozens), `render/camera.test.ts` (stepping, stopping at both ends, the map in the middle), `render/terrainDetail.test.ts`.
