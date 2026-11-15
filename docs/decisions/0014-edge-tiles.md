# 0014 - Edge tiles: a ground texture may end with an edge drawn inside its own tiles

Status: accepted. Date: 2026-11-15. Builds on [0011](0011-ground-tile-textures.md) and takes the decision it left open: "Transitions (edge tiles, autotiling) are a later decision." From ticket #57.

## Context

A lake needs a coast. With 0011 alone, where water met grass the edge was the tile edge: a lake was blue squares on green squares, and read as a sheet lying on the ground. The coast has to show that the water is below the grass, and the lake has to turn corners round, without the grass tiles, the sim or the areas' rows learning anything about it.

## Decision

- A `GroundTileSprite` may carry `edgeTiles: { sameSurfaceDefIds }` (`features/terrain/defs.ts`). Its sheet then holds, after its variants, one more tile for every edge shape: the same ground with the end of the surface drawn inside the tile, on the sides where the surface ends. The tile beyond the edge is never touched: grass beside a lake is drawn as grass everywhere else.
- An edge shape is which of a tile's eight neighbours are the same surface, as bits (`EdgeNeighbour`), with a diagonal dropped unless both tiles beside it are the same surface (`edgeShapeOf`). That leaves 46 shapes with an edge, listed in `EDGE_SHAPES`; the order of that list is the order of the tiles in the sheet. These live in the sim's terrain defs, a function among data, because they are the contract for the order of a sheet that the def declares: the client that picks a tile and the test of the tool that paints the sheet both read the one list. `variantOfTile` stays in the client because nothing but the client depends on which variant a tile gets. The sim itself never calls them.
- The client picks the tile (`render/groundTiles.ts`): a tile whose eight neighbours are all the same surface shows a variant, as before; any other shows the edge tile of its shape. Neighbours are read from the map, so a chunk draws the same whatever is loaded around it, and the end of the map counts as not the surface.
- A lake is two defs. `water` is deep and solid; `shallows` is walked on and rings it. The shallows' same surface is both of them, so their edge is drawn against the land: that is the coast. Deep water's same surface is itself alone, so its edge is drawn against the shallows: a step of colour. Content keeps deep water from touching land, corners included (`content/world/lakes.test.ts`), so the coast is always drawn by the shallows' sheet.
- The coast is drawn as a drop, seen from the south and above like everything else: an earth bank under the grass, tall on the far shore, thin at the sides, the lip of the turf alone on the near shore, and the bank's shadow on the water. Nothing at the coast is brighter than the water; a pale rim was tried first and made the lake look raised.
- Both sheets come from `packages/client/tools/generate-water-sheet.mjs` (`pnpm --filter @novaland/client art:water`). The generator is plain Node and cannot import the sim, so it repeats the shape list; its test fails if the two differ.
- A sheet that failed to load still falls back to one flat tile per def, with no edges.

## Consequences

- Another surface with an edge (sand, a path, a cliff top) is `edgeTiles` on its def and a sheet with 46 more tiles. No client code.
- The edge is inside the surface's own tiles, so it costs the surface up to six of a tile's sixteen pixels at its rim (the far shore: four of wall, two of shadow) and the other ground nothing. Two surfaces that both want to draw the edge between them would each draw one; give `edgeTiles` to one of the two, or list each in the other's `sameSurfaceDefIds`.
- The ground tileset grows by 46 tiles per edged surface. It is one row: 135 tiles today, 2160 texture pixels wide. Well before 4096 pixels it needs to wrap into rows.
- Where a lake turns a corner, the sheet fills the rounded corner with the flat green of the grass sheet's turf, whatever lies beyond. That is right while lakes lie in grass; a lake in sand or dirt needs the outside colour to come from the def beyond.
- Players wading in the shallows are drawn standing on the water. Showing them knee-deep is a later choice.
