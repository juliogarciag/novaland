# Regions of the real Earth

`pnpm region:build` turns public data about a piece of the Earth into a map the sim can play: natural ground only, hundreds of metres to a tile. It writes `packages/sim/src/content/world/regions/<name>.ts`, rows of tiles like any other content, which is committed. The raw data is not: it is downloaded into `scripts/region/.cache/` (gitignored, about 430 MB for the Alps) on the first run and read from there afterwards. The same inputs always write the same file.

A region is not part of the world players join. A dev build plays one by itself to judge a scale:

```bash
VITE_REGION_MAP=alps PORT=5170 pnpm dev
```

Add `?at=<latitude>,<longitude>` to the address to start the walk on the walkable tile nearest to a place, for example `http://localhost:5170/?at=46.21,6.16` for Geneva.

## Sources and licences

| What | Dataset | Licence | Credit line |
|---|---|---|---|
| Height | [Copernicus DEM GLO-90](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), 3 arc seconds, read from its public bucket on AWS | Copernicus DEM licence: free of charge for any use, derived works included, with the credit line | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved |
| Land cover | [ESA WorldCover 10 m 2021 v200](https://esa-worldcover.org), read from its public bucket on AWS | CC BY 4.0 | © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium |
| Rivers and lakes | [Natural Earth](https://www.naturalearthdata.com) 1:10m rivers, lake centerlines and lakes, with the Europe supplements, v5.1.2 | Public domain | Made with Natural Earth |

The credit lines are written into every generated region, as comments and as its `sources` field, so they travel with the data. A game that ships a region has to show them somewhere a player can read.

## Scale and projection

The projection is equirectangular (equidistant cylindrical) on a sphere of radius 6371.0088 km, with the region's middle latitude as its standard parallel. A column is a fixed step of longitude and a row a fixed step of latitude, so a tile is `kilometresPerTile` tall everywhere and `kilometresPerTile` wide at the middle latitude. For the Alps that is 0.6 km at 46.02°N; at the north edge a tile covers 3% less ground east to west and at the south edge 3% more.

This is not the projection a whole globe of 32,768 by 16,384 tiles would have. That globe is equirectangular with the equator as its standard parallel: 1.22 km a tile at the equator, but at 46°N a tile is still 1.22 km tall and only 0.85 km wide, so that globe stretches the Alps 1.44 times from east to west. The Alps region is twice as fine as that globe: 0.6 km a tile.

## How a tile is decided

Each raster is read several times finer than a tile (height at about 90 m, the files themselves; land cover at an overview of about 75 m), and every sample is added to the tile it falls in. Then, per tile (`tileKinds.mjs`):

1. The most common land cover decides. Farmland and towns count as the open ground they stand on: the world has no human things.
2. Water, or no data (open sea), is water. Permanent snow and ice is glacier.
3. Otherwise a mean height of 2,800 m or more is summit.
4. Otherwise trees are forest below 1,000 m and mountain forest above; bare ground is scree; wetland is marsh.
5. Otherwise it is open ground, read by height: grass below 500 m, upland to 1,500 m, alpine meadow to 2,300 m, scree above.

Then the vector data (`regionTiles.mjs`): a tile whose centre is inside a Natural Earth lake becomes water, which keeps narrow lake arms in one piece; every river is drawn along its line, over walkable ground only, each tile of the line sharing a side with the next, and one, two or three tiles wide by the rank Natural Earth gives the river (`riverWidthInTiles`: rank 6 or better is three, 7 to 9 two, the rest one). No river here is as wide as a tile, so the width is a sign of the river's size, as on an atlas, and a river keeps it from source to mouth; water the land cover saw along a river (a wide river shows as a string of ponds) becomes river too, when every tile of it touches a river tile (a lake a tile or two wide with the river drawn along its banks goes with it); and every water tile that touches land becomes shallows, where the coast is drawn (ADR 0016).

Summit, glacier, water and shallows stop a player. Rivers do not: there are no boats or bridges yet, and a river that stopped a walker would cut the map into strips.

## Adding a region

1. Write `regions/<name>.mjs` like `regions/alps.mjs` (corner, size in tiles, kilometres per tile, spawn) and list it in `regions` at the top of `build-region.mjs`.
2. Run `pnpm region:build <name>`.
3. Add the generated module to `regions` in `packages/sim/src/content/world/regions/index.ts`.

A region is one area in one file. At 896 by 640 tiles that file is 585 KB (111 KB gzipped), the sim builds its colliders in about 105 ms and a snapshot with its hash takes about 65 ms. That is four times the largest map measured before (ADR 0013, 400 by 300) and it still plays; much bigger than that needs what ADR 0013 left for later: chunks loaded as players move, and a storage format that is not rows of text.
