# 0010 - Standing tiles: tall tile art is one image per tile, sorted among the entities

Status: accepted. Date: 2026-11-14. Builds on [0003](0003-levels-as-tiles.md) and replaces only its last consequence ("real art replaces `ensurePlaceholderTileset` with a loaded tileset image and gives each `TileDef` a texture index") for tiles that stand up from the ground. Flat tiles are still generated placeholders. From ticket #36.

## Context

A tree drawn as a tree is taller than its tile: the canopy overhangs the tile to the north and a few pixels to each side. The ground tilemap sits below everything (`TERRAIN_DEPTH`), so art in that layer can never cover a character who walks behind it. The sim must not learn about any of this: a tree is one solid 1x1 metre tile (ADR 0003) and stays that.

## Decision

- A `TileDef` may carry `standing`, a `StandingTileSprite` (`features/terrain/defs.ts`): the image key, its frame size, its pixels per metre, how many variants the sheet holds side by side (`variantCount`), and `groundDefId`, the flat tile drawn under it. It is data for views; nothing in the sim reads it.
- The client draws such a tile as one Phaser image, with its bottom centre on the bottom centre of the tile, on top of the ground tilemap, which shows the `groundDefId` tile there (`render/terrain.ts`, `render/standingTiles.ts`). The level rows are still the only source of where things are.
- The image's depth is the tile's bottom edge in pixels. Entities are sorted by the bottom edge of their body (`render/entities.ts`), so one rule orders everything that stands on the ground: whatever has its foot further south is drawn in front. A character north of a tree is behind its canopy and south of it in front. Beside it and level with it the character is behind, because the tile's foot is further south than the body's; a little further south the character is in front. Both get their depth from `depthOfBottomEdge` (`render/depth.ts`).
- Which variant a tile shows is a hash of its column and row, computed in the client. It is the same for every player and every visit, and it is looks only, so it is not sim state.
- A standing sprite's key is unique among all sprite keys of all defs (a sim test checks it): they share `sprites/<key>.png` and Phaser's texture keys.
- If the image fails to load, the tile is drawn flat in the def's `color`, as before.
- The sheet is generated (`packages/client/tools/generate-tree-sheet.mjs`, `pnpm --filter @novaland/client art:tree`) and committed, like the avatar sheets.

## Consequences

- A new tall thing that is still one solid tile (a bush, a pillar, a lamp post) is a `standing` entry on its def and a PNG. No client code.
- One image per tile: the starter level has 345. That is fine for Phaser; if a level ever has tens of thousands, the images need culling or a layer per row, and only `drawTerrain` changes.
- An image may be wider than its tile, so it covers a few pixels of a character standing beside it. Keep the overhang to the sides small: the collider is still the tile.
- Trees in the same row have the same depth and are drawn left to right, so where two canopies overlap the eastern one is on top. That relies on Phaser sorting equal depths stably (`DisplayList.depthSort` uses `StableSort`). Art must look right either way.
- Art taller than two tiles would overhang tiles whose own images are drawn earlier; nothing prevents it, the sort still holds.
- Flat tiles (grass, dirt, rock) are unchanged. When they get art it goes in the tilemap, as 0003 says.
