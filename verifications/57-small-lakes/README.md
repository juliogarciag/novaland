# Verifications of ticket 57, "Small lakes"

What the ticket promises: a water tile nobody walks on, drawn flat; several lakes of different shapes across the world, none on the spawn; a world that is still in one piece; a colour on the water def that a minimap can use. After the first review of the PR: lakes a bit bigger, and a coast, with shallow water between the land and the deep, drawn so that the lake lies below the ground and not on top of it.

Run it from anywhere; the first run installs Playwright and pngjs in the folder:

```bash
bash verifications/57-small-lakes/run.sh
```

| Step | What it proves | Proof |
|---|---|---|
| sim tests (`run.sh`) | Headless, in the sim. `content/world/lakes.test.ts`: water is solid and flat under def id 204, the shallows walked on and flat under 205; a player walking from the spawn into the clearing's lake wades into the shallows and stops at the edge of the deep water; the lakes are at least six, at least six tiles across, of different shapes, none a rectangle, deep water never touching land, every tile of the shallows touching the deep, none within ten tiles of the spawn. `content/world/world.test.ts`, "spawns on grass, with every other walkable tile of every area within reach on foot": the world is still in one piece with the lakes in it (deep water is solid, so that walk does not cross it; the shallows are walked on, so every tile of them must be reached). The older terrain and player tests still pass. | `proof/sim-tests.txt` |
| `lakes.mjs` | In the running game (`pnpm dev`, Chromium): finds every lake from the map the page holds; walks from the spawn to a lake **on the keyboard** (the shortest walk of two keys that ends in deep water), wades in and keeps walking, and the player stops at the edge of the deep; then walks to every other lake over walkable tiles alone, pushes into its deep water and is held in the shallows; at each, the lake's tiles that are whole on screen (at least half of them) are blue, the shallows paler than the deep, the sides of the shallows that face grass show the bank (earth on the far shore and the sides, the dark lip of the turf on the near shore) with nothing there brighter than the water, and the grass round the lake is green; in no frame of the walks between lakes is the player on a solid tile. Paints the world from tile def colours alone, as a minimap does. | `proof/lakes.txt`, `proof/lakes.json`, `proof/shore-clearing.png` (the player in the shallows, stopped at the deep), `proof/lake-<area>.png` (seven more lakes), `proof/world-by-colour.png` |

Nothing about where the lakes are is typed into the script: lakes, routes and expected positions come from `window.__novaland`.

## Notes

- "Some near paths, some off them" is judged by eye, from `proof/world-by-colour.png`: the trails are grass like the rest of the ground, so no check can tell a path from a meadow.
- The keyboard walk uses the real keys (D, then S). The walks to the other seven lakes steer with `queueCommand`, the path the keyboard's commands take, because a route through the forest trails is hundreds of key changes.
- A lake counts as drawn when four of five points of each of its deep tiles are blue in the screenshot, and three of five of each shallows tile, which also carries the bank; tiles under the HUD, or with a tree or a rock beside them or in the row below, are not looked at, since those are drawn over them; the tile the player stands on and the one above it are left out, since the player's sprite covers them. The bank is looked for only on sides with open grass two tiles deep, because a tree next to the water leans over it.
- "Looks sunk, not raised" is a judgement of the eye in the end. What the script can hold on to is what made the first coast look raised: a rim brighter than the water. It checks there is none, and that the bank is earth.
- `world-by-colour.png` is not the minimap (ticket 56 is on another branch). It is the same idea, every tile filled with its def's `color`, to show the lakes read at that size.
