# 0013 - The world as chunks: one map that grows, authored as areas, with terrain out of world state

Status: accepted. Date: 2026-11-14. From ticket #47. Supersedes [0003](0003-levels-as-tiles.md) where it says a level is one grid centred on the origin, that each collider rectangle is an entity, and that features add fields to `LevelData`; its tile kinds, legend and merging rule stand. Replaces the second consequence of [0010](0010-standing-tiles.md) ("if a level ever has tens of thousands, the images need culling"): they are culled now. Supersedes the `level` field of the welcome in [0004](0004-multiplayer-netcode.md) and its "static entities (terrain) travel once, in the full state"; the sentence of [0002](0002-physics.md) that puts the origin at the level centre; and, in [0006](0006-client-online-mode.md), that the level comes with the welcome and that an unknown level name is what makes a server incompatible (it is the map checksum now). Builds on the prediction ADR, [0012](0012-client-side-prediction.md), and changes two things it states: `createPrediction` takes `{ map, capacity }`, both optional, where it took `{ level, capacity }`, and "terrain comes from the level" reads "from the map".

## In short

There is one world and it only gets bigger. Before this, the world was one grid in one file with (0, 0) at its centre, and every tree clump was an entity that the server rebuilt, compared and sent. So a bigger map moved every coordinate, every agent edited the same file, and the cost of sending grew with the ground instead of with what moves (a 400x300 map: 3,314 entities, 6 ms per send, 650 KB to join).

Now the ground is written as **areas** (a file each, mounted at coordinates it reserves), kept as **chunks** of 32x32 tiles, and measured from an origin that never moves. Terrain is no longer made of entities: the server and each browser build the same colliders from the same map, and nothing about the ground travels or is counted. The same 400x300 map costs 5 entities, 0.02 ms per send and 1.4 KB to join, the same as the 40x30 one.

## Context

Novaland is a single open world that agents keep adding to. Interiors (houses, caves) will be regions of the same world, mounted out of the way and reached by a door that teleports: one sim, one physics world, one snapshot, never a second level. That ticket is not this one, but the format has to carry it.

Three things stood in the way, all measured before the change (`verifications/47-world-as-chunks/baseline/`):

- **Terrain was paid for on every send.** Colliders were entities, so `worldState` listed them and `diffWorldState` compared them twenty times a second, and a joiner received all of them.
- **The origin was the centre of the map.** Growing the grid on any side changed the metres of every position and the tile of every spawn.
- **One file.** Two agents adding terrain in different places both edited `starter.ts`.

## Decision

### One coordinate space, fixed

- Tile `(column, row)` covers the metres from `(column, row)` to `(column + 1, row + 1)` times `TILE_SIZE`. Tile (0, 0) has its top-left corner on the origin; columns and rows west and north of it are negative. `tileCentre(tile)` and `tileAt(x, y)` are pure arithmetic and take no map.
- The first area, the clearing, has its top-left tile at (0, 0), so every tile coordinate of the old level is unchanged (the spawn is still (6, 14)) and so is every tile's look, which is a hash of its column and row (ADR 0010, 0011). Positions in metres moved once, by (+20, +15), and never will again.
- No area may reach further than `WORLD_LIMIT_TILES` (16,384) from the origin. Rapier keeps positions as 32-bit floats: that far out they are exact to about a millimetre, and a step of a walk (centimetres) is rounded to that, so walking speed drifts with distance: the same command covers 10.00 m at the origin, 9.96 m at 3,000 tiles and 9.84 m at 16,000. Server and prediction round alike, so nothing is corrected. "Out of the way" for an interior means a few thousand tiles at most, and nearer is better.

### Areas are how terrain is written

- An `AreaData` (`content/world/types.ts`) is what a level was, minus the spawn, plus a place: `{ name, origin, legend, rows }`. It reserves the rectangle of world tiles its rows cover, starting at `origin`. One file per area in `content/world/areas/`.
- The `WorldMap` is `{ areas, spawn }`, and there is one: `worldMap` in `content/world/index.ts`, which lists the areas, one line each. That list is the only file two agents adding terrain both touch, and they touch one line of it, like `features/index.ts`.
- `readMapTiles(map)` refuses, by throwing with the areas' names, two areas that share even one tile, two areas with one name, ragged rows, an unknown character, a def that is not a tile, an origin that is not a tile or beyond the limit, and a spawn that is not on a walkable tile. It runs when the sim is created, so a bad map never reaches a command handler (as 0003 had it).
- Outdoors, areas sit side by side and should stay small enough to edit by hand (the clearing is 40x30). An interior is an area mounted where nothing else is. Tiles no area drew simply do not exist: nothing is stored, drawn or collided there.
- An area is an authoring idea only. At runtime nothing knows which area a tile came from.

### Chunks are how terrain is kept

- `readMapTiles` cuts the areas into `MapChunk`s of `CHUNK_SIZE` = 32 tiles a side: a `Uint16Array` of def ids, row by row, `NO_TILE` (0) where no area drew. Only chunks that hold a tile exist. They are listed top row first, then left to right, and that order is the order colliders are built in.
- 32 was chosen against the screen: the camera shows 20 to 40 tiles across (`MIN_VISIBLE_METRES`, whole-number zoom), so a screen touches four chunks at most times and nine at worst, and a chunk's tilemap is 1,024 tiles. Smaller chunks mean more seams in colliders and more game objects; larger ones draw more ground than the screen needs.
- There are no chunk files. A chunk is derived, like `TileGrid` was; what is committed is areas. Storing chunks as files would make two agents working near each other edit the same file again, which is the problem areas solve.
- `MapTiles.checksum` (FNV-1a over the tile and chunk sizes, which tile defs are solid, the spawn and every chunk) names the terrain: what the ground is and what stops a player on it. The same tiles give the same checksum however they are cut into areas. How tiles look is not in it.

### Terrain is not entities

- The terrain feature builds, per chunk, one immovable Rapier body holding a box per merged rectangle of solid tiles (`createStaticBoxes` in `core/physics.ts`, `solidRectangles(chunk)`). No entity, no component: `TerrainCollider` is gone, and so is every terrain id.
- Rectangles are merged inside a chunk only. A wall that crosses a chunk edge is one box on each side. That is what a later ticket needs to add or drop a chunk's colliders by itself, and it costs two extra boxes in today's world (45 against 43). The seam is not perfectly smooth: a ball sliding diagonally along a wall is pushed about 4 mm off it on the tick it crosses a chunk edge and settles back within six ticks. That is a sixteenth of a pixel, the same on the server and in a prediction, and a sim test slides a player along such a seam to keep it from growing.
- This keeps rule 3. The colliders live in the physics world, which `snapshot()` captures byte for byte, and `snapshot().map` is the map's checksum, so a snapshot says which ground its physics bytes hold. The snapshot is version 2 (`level` became `map`).
- World state is what moves. `worldState`, `diffWorldState`, the welcome's full state and entity capacity no longer see terrain at all.
- Loading and unloading chunks as players move is not done: the sim builds every chunk's colliders at boot, which takes about 40 ms at 400x300 (`bootMs` in the ticket's `proof/03-measure.json`). Streaming has its own questions (snapshots, entities standing in an unloaded chunk) and gets its own ticket. A snapshot's size and hash still grow with the map, because the physics bytes do (24 ms at 400x300, from 85 ms); that is paid when someone snapshots, not per send.

### What changes for prediction (ADR 0012)

- A prediction is a `Sim`, so it runs the same terrain feature on the same map and gets the same colliders in the same order. A test compares the boxes of a prediction and of a server sim.
- `adoptEntity` refuses an id the prediction uses for something it made itself. That used to be terrain: a prediction held trees under ids 1 to 43, and it worked only because the server's sim had built the same trees first and so never gave a player one of those ids. With terrain out of the entities, a prediction starts with no entity at all, and the first player a server seats has id 1. The rule in `adoptEntity` stays for a feature that spawns things by itself in a prediction; none does.

### The wire

- `WelcomeMessage.level` (a level name) is replaced by `map`: the checksum of the server's map. `WIRE_PROTOCOL` is 3.
- There is one world, so the `levels` registry and `findLevel` are removed. The client builds its replica and its prediction on its own `worldMap` and refuses a server whose checksum differs, as `incompatible`, with the reload button. That matters more than the name did: terrain does not travel, so a page left open across a deploy that changed the map would draw and predict against ground the server no longer has. `WIRE_PROTOCOL` only catches changed messages; the checksum catches changed ground. It does not cover anything else two builds may disagree on (a player's speed, say): that was true before and still is.
- `createSim`, `createReplica` and `createPrediction` take an optional `map` and default to `worldMap`. Another map is for tests and measurements (`generatedWorldMap({ columns, rows })` makes one by rule).

### The client draws by chunk

- `TerrainRenderer` (`client/src/render/terrain.ts`) replaces `drawTerrain`. Every frame, after the camera has moved, it is given what the camera shows. A chunk with a tile within `DRAW_MARGIN_TILES` (2) of that gets a ground tilemap of its 1,024 tiles and one image per standing tile (ADR 0010); a drawn chunk is dropped once all of it is further than `KEEP_MARGIN_TILES` (18) away. The gap between the two is so that pacing over a chunk edge does not build and drop the same chunks. Online the camera follows a position the server sent, so the view is not trusted: a view that is not finite changes nothing, and only chunks inside the map's bounds are ever looked for.
- The draw margin covers how far a standing image overhangs its tile (a tree reaches one tile north); a test checks it against every standing sprite.
- All chunks share one ground tileset, built once per scene. A tile's variant is a hash of its world column and row, so it looks the same whichever chunk it is drawn with.
- Standing images in one row have the same depth, and 0010 relied on creation order to put the eastern one on top. Chunks are created in whatever order the player walks, so a standing image's depth now has `column * 1e-6` added: less than a sixtieth of a pixel across the whole world, enough to order a row from west to east.
- The camera is bounded by `MapTiles.bounds`, the rectangle that holds every area. With one area that is the clearing, as before. Once an interior is mounted far away this is wrong and the ticket that adds interiors must bound the camera by the place the player is in.

## Consequences

- Adding terrain is a new file in `content/world/areas/` and one line in `content/world/index.ts`. The ticket asked that two agents adding terrain not edit the same file; they still share that list, one line each. A list written by hand was preferred to finding area files at build time, which the sim cannot do without Node or a bundler (rule 5, rule 9). Moving an area is changing its `origin`.
- Every position ever written down in metres from before this change is off by (20, 15). Nothing stored any: there are no save files yet (#2).
- Send cost, join size and entity capacity depend on entities. A map can grow until snapshot time or boot time hurts, not until the wire does.
- A feature that wants its own things in the world (coins, doors) no longer adds a field to a level. It adds an optional field to `AreaData`, in the area's own coordinates, and reads it in its `init` through the area's `origin`; the door ticket will be the first and should settle the shape.
- A joining player is placed on a free tile within 32 tiles of the spawn (`SPAWN_SEARCH_RINGS`), else on the spawn tile. The search used to run to the edge of the level; with one world whose bounds may span a far interior it has to stop somewhere, because it runs inside a command handler.
- Anything a view needs about the ground comes from `readMapTiles(sim.map)`, `tileDefIdAt`, `findChunk` and `chunkCoordinateOf`, all exported from the sim. `window.__novaland` has `map`, `tiles`, `chunkSize`, `tileDefIdAt(tile)` and `terrain()` (which chunks are drawn, how many tiles and images) in place of `level` and `grid`.
- A deploy that changes the map makes every open page show the incompatible screen until it reloads. That is the intent.
- Colliders are cut at chunk edges, so there are more seams than before for a sliding ball to meet. The player is a ball with continuous collision detection (ADR 0002) and the seam test passes; a body with corners would need the seams looked at again.
- `generatedWorldMap` and `VITE_GENERATED_MAP=400x300` (dev builds, solo) exist to measure big maps. They are not content.
