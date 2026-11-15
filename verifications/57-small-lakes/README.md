# Verifications of ticket 57, "Small lakes"

What the ticket promises: a water tile nobody walks on, drawn flat; several small lakes of different shapes across the world, none on the spawn; a world that is still in one piece; a colour on the water def that a minimap can use.

Run it from anywhere; the first run installs Playwright and pngjs in the folder:

```bash
bash verifications/57-small-lakes/run.sh
```

| Step | What it proves | Proof |
|---|---|---|
| sim tests (`run.sh`) | Headless, in the sim. `content/world/lakes.test.ts`: water is solid and flat under def id 204; a player walking from the spawn into the clearing's lake stops at its shore; the lakes are at least six, small, of different shapes, none a rectangle, with grass all round, none within ten tiles of the spawn. `content/world/world.test.ts`, "spawns on grass, with every other walkable tile of every area within reach on foot": the world is still in one piece with the lakes in it (water is solid, so that walk does not cross it). The older terrain and player tests still pass. | `proof/sim-tests.txt` |
| `lakes.mjs` | In the running game (`pnpm dev`, Chromium): finds every lake from the map the page holds; walks from the spawn to a lake **on the keyboard** (the shortest walk of two keys that ends in water) and keeps walking into it, and the player stops at the water's edge; then walks to every other lake over walkable tiles alone, pushes into its water and is held on the shore; at each, the lake's tiles that are whole on screen (at least half of them) are blue and the grass round them green; in no frame of the walks between lakes is the player on a solid tile. Paints the world from tile def colours alone, as a minimap does. | `proof/lakes.txt`, `proof/lakes.json`, `proof/shore-clearing.png` (the player stopped at a shore), `proof/lake-<area>.png` (seven more lakes), `proof/world-by-colour.png` |

Nothing about where the lakes are is typed into the script: lakes, routes and expected positions come from `window.__novaland`.

## Notes

- "Some near paths, some off them" is judged by eye, from `proof/world-by-colour.png`: the trails are grass like the rest of the ground, so no check can tell a path from a meadow.
- The keyboard walk uses the real keys (D, then S). The walks to the other seven lakes steer with `queueCommand`, the path the keyboard's commands take, because a route through the forest trails is hundreds of key changes.
- A lake counts as drawn when four of five points of each of its tiles are blue in the screenshot; the tile the player stands on and the one above it are left out, since the player's sprite covers them.
- `world-by-colour.png` is not the minimap (ticket 56 is on another branch). It is the same idea, every tile filled with its def's `color`, to show the lakes read at that size.
