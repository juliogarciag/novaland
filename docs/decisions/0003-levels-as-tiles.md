# 0003 - Levels as tile grids

Status: accepted. Date: 2026-11-07.

## Context

The first level was a list of wall rectangles in metres. The world we want is Stardew-like: ground made of tiles, forests, paths, rocks, and later farms and buildings. Levels will be drawn by many agents, mostly in a text editor, and must stay data (ADR 0001). The sim needs collisions from the same source the client draws from, with no duplicated knowledge of where things are.

## Decision

- A level is `{ name, legend, rows, spawn }` (`content/levels/types.ts`). `rows` are ASCII strings, one character per tile, top row first; `legend` maps each character to a terrain def id; `spawn` is a tile coordinate. One tile is `TILE_SIZE` metres (1 m), the level is centred on the origin, y points down (ADR 0002).
- Tile kinds are defs in `features/terrain/defs.ts` (`TileDef`, id block 200-299) with a `solid` flag and a placeholder colour. A new kind of tile is a new entry there; drawing it into a level is a new legend character. The `walls` feature and its id block 100-199 are retired; the ids stay reserved.
- `content/levels/grid.ts` turns a level into a `TileGrid` of def ids in metres, once per level object, and owns the tile-to-metre conversion (`tileCentre`, `tileAt`, `spawnPoint`); the sim and the client both place things through it. A malformed level (ragged rows, unknown character, non-tile def, spawn off-grid) throws at sim creation, from the terrain feature's `init`: levels are repository content, so failing loudly beats guessing, and no command handler ever sees a bad level.
- The `terrain` feature builds colliders from solid tiles only: horizontal runs are merged, then identical runs on consecutive rows are stacked, so a 40-tile tree row is one box and a 3-tile-thick border is one box per side (`rectangles.ts`). Each rectangle is one entity with `TerrainCollider` (tile rectangle), `Extents`, `Position` and a fixed Rapier cuboid. Walkable tiles have no entity.
- Terrain colliders carry no `DefRef`, so `getRenderables` never returns them. The client draws the whole grid itself as a Phaser tilemap from the same `LevelData`, generating one flat-colour 16x16 tile per terrain def until there is art (`client/src/render/terrain.ts`). What the player collides with and what the player sees come from one set of rows.

## Consequences

- Authoring a level is editing strings. A verification or test can derive any expectation from the grid (where the first tree above the spawn is, which tile the player stands on) instead of hardcoding numbers.
- Merging keeps entity and collider counts small (the starter level: 44 colliders cover the 356 solid tiles of its 1,200), but a tile edit changes which rectangles exist, so snapshots of different level versions are not comparable. They never were.
- Seams between adjacent collider boxes are where a sliding ball can catch; merging reduces seams, and the player is a ball with continuous collision detection (ADR 0002), which handles the rest.
- Tiles are square and axis-aligned. Sloped or non-grid obstacles would be a separate feature with its own entities, not a tile kind.
- A level describes terrain only. Features that need their own content placed in a level (coins, doors, spawners) add an optional field to `LevelData` and read it in their `init`; the legend stays about tiles.
- Textures are generated placeholders. Real art replaces `ensurePlaceholderTileset` with a loaded tileset image and gives each `TileDef` a texture index; nothing in the sim changes.
