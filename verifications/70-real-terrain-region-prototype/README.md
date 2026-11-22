# #70 Real-terrain region prototype

What is verified: the Alps region committed in `packages/sim/src/content/world/regions/alps.ts` is exactly what `pnpm region:build` makes from the public data, a player can walk it in the browser with `VITE_REGION_MAP=alps`, the lakes, seas, summits, plain and rivers are where an atlas puts them, and none of it ships in a production build.

Run it from anywhere (the first run installs Playwright here and downloads about 100 MB of public data into `scripts/region/.cache/`):

```bash
bash verifications/70-real-terrain-region-prototype/run.sh
```

| Script | What it proves | Proof |
|---|---|---|
| `01-build.mjs` | Running the script again writes the committed file byte for byte; the map is 448x320 tiles of 1.2 km from west of Geneva to east of Venice; every dataset covered the region; the eight big rivers are drawn; 99.97% of the walkable ground is reachable from the spawn | `proof/01-build.txt`, `proof/01-build.json`, `proof/01-build-report.json` (tiles by kind, tiles by river) |
| `02-walk.mjs` | In Chromium against `VITE_REGION_MAP=alps pnpm dev`: the page plays the region; 9 lakes and seas, 6 summits and glaciers, 3 places on the plain and 10 rivers at their towns are at the latitude and longitude an atlas gives; a walker is stopped by Lake Geneva and wades across the Po, with the keyboard; `?at=` starts the walk at six places | `proof/02-walk.txt`, `proof/02-walk.json`, `proof/02-whole-map.png` (every tile in its def's colour, 3 pixels a tile), `proof/02-view-*.png` (what the player sees at the spawn and at six places) |
| `03-bundle.mjs` | After `pnpm build`, neither the client bundle nor the server bundle holds the region's rows | `proof/03-bundle.txt`, `proof/03-bundle.json` |

The coordinates in `02-walk.mjs` are typed from an atlas and are the only numbers that do not come from the game. Which tile a place falls in, what that tile is called and whether it stops a player are read from `window.__novaland` (`tileOfCoordinates`, `tileDefIdAt`, `defs`).

The same places are also checked headlessly, on every `pnpm test`, by `packages/sim/src/content/world/regions/regions.test.ts`, and the script's arithmetic by `scripts/region/region.test.mjs`.
