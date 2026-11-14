# 0011 - Ground textures: a flat tile's art is a sheet of variants copied into the ground tileset

Status: accepted. Date: 2026-11-14. Builds on [0003](0003-levels-as-tiles.md) and [0010](0010-standing-tiles.md). It replaces one line of 0010's consequences: "Flat tiles (grass, dirt, rock) are unchanged". Grass now has a texture, and the rock is a standing tile. For flat tiles it also replaces 0003's last consequence ("real art replaces `ensurePlaceholderTileset` with a loaded tileset image and gives each `TileDef` a texture index"): the tileset is still put together by the client, from sheets, and a def has no texture index. From ticket #42.

## Context

The ground was one flat colour per tile def. Grass needs to read as grass over the whole floor, without the tile grid showing and without one tile repeating as a stamp. It is also the ground drawn under every tree and rock (`groundDefId`), so whatever a grass tile shows, the ground under a standing tile must show the same. As with standing tiles, the sim must not learn about any of it.

## Decision

- A `TileDef` may carry `groundSprite`, a `GroundTileSprite` (`features/terrain/defs.ts`): the image key, the side of one tile in texture pixels and how many variants the sheet holds side by side. It is data for views. A def has `groundSprite` or `standingSprite`, never both.
- Every variant is the whole texture with its details in other places, and any variant must look right next to any other. Variants are not "plain tile" and "decorated tile": a field is one texture, not a flat fill with decorations.
- The ground is still one tilemap layer under everything, with one tileset. The client builds that tileset at start (`render/groundTiles.ts`, `render/terrain.ts`): each tile def owns a run of tiles in it, the variants of its sheet when it has a loaded `groundSprite`, one flat tile in its `color` otherwise. The tile index of a def is therefore no longer its position in `terrainDefs`; `groundTilesetSlots` says where each def starts.
- Which variant a tile shows is `variantOfTile` (`render/tileVariant.ts`), the same hash of column and row that picks a standing tile's frame. The ground under a standing tile is its `groundDefId` in the variant of that tile's own column and row, so removing a tree leaves the grass that was under it.
- A ground sprite's tiles must be `GROUND_TILE_PIXELS` (16) square; a client test checks every def, and building the tileset throws for one that is not.
- If a sheet fails to load, its def is drawn as one flat tile in its `color`, as before.
- The rock is a standing tile (0010): a boulder stands up from the ground it is sunk into and has to sort against the player like a tree. Its sheet paints the grass at its foot in the grass sheet's own greens (`GRASS_COLORS`), so the two must change together.
- The sheets are generated (`packages/client/tools/generate-grass-sheet.mjs`, `generate-rock-sheet.mjs`; `pnpm --filter @novaland/client art:grass`, `art:rock`) and committed. The generators share `tools/pixelCanvas.mjs` and `tools/sheetFile.mjs` with the tree's.

## Consequences

- A new textured ground (sand, water, dirt) is a `groundSprite` entry on its def and a PNG. No client code.
- There is no blending between two kinds of ground: where grass meets another textured ground the edge is the tile edge. Transitions (edge tiles, autotiling) are a later decision.
- All variants appear equally often. To make a detail rare, paint it on few tiles of a large sheet (the grass sheet has flowers on 2 of its 24).
- The tileset is a canvas texture built each time a level is drawn; a def's art cannot change while the level is on screen.
