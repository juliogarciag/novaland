# 0017 - The world's art at 32 pixels per metre

Status: accepted. Date: 2026-11-19. Supersedes the 16 of [0011](0011-ground-tile-textures.md) ("A ground sprite's tiles must be `GROUND_TILE_PIXELS` (16) square") and settles what [0016](0016-edge-tiles.md) left open about the ground tileset's width. From ticket #64.

## Context

The player is moving to a 32x48 sheet (#65): the same figure with twice the pixels. Drawn next to 16-pixel terrain it would be the only fine thing in a coarse world, or the camera would have to show it at half the size. The art of the whole world has to move to the same density, and nobody playing should see the world get bigger or smaller.

## Decision

- One metre is 32 texture pixels: `PIXELS_PER_METRE` in `client/src/render/units.ts`, the ground tileset's `GROUND_TILE_PIXELS`, and every terrain sprite's `tilePixels` or `pixelsPerMetre` in `features/terrain/defs.ts`. The sim's metres, bodies and areas do not change.
- The terrain sheets are redrawn, not scaled: their generators in `packages/client/tools` paint at 32 pixels per tile with the same shapes, colours and variant counts, and spend the extra pixels on finer detail (one-pixel outlines, two-pixel leaves, blades of three to five pixels, a turf edge over the lake's bank).
- The camera keeps its rule in metres (`render/zoom.ts`): the largest whole zoom that shows at least `MIN_VISIBLE_METRES`. With twice the pixels per metre a screen gets half the zoom and the same metres. Where the zoom at 16 was odd, 2k + 1, it is now k, and the screen shows (2k + 1) / 2k times the world it did: half as much again for a canvas 960 to 1279 device pixels wide (zoom 3 became 1), a quarter more at 1600 to 1919 (5 became 2), an eighth more at 2880 to 3199 (9 became 4). Common full-screen widths (1280, 1440, 1920, 2560, 3456, 3840) land on even zooms and see exactly what they saw. A whole zoom is what keeps the pixels crisp, and none between those would still show the minimum, so that is the price.
- What is sized for the eye, not the art, is sized in metres: a pixel of a name's letters is 0.6/16 of a metre (`nameLabel.ts`) and the gap above a head 1/16, so names keep their size on screen. The minimap, the HUD and the cursors are in CSS pixels and do not change.
- A sheet drawn at another density still works: views scale every sprite by `PIXELS_PER_METRE / pixelsPerMetre`, so a sheet drawn at 16 pixels per metre would draw at 2x. The player's 32x48 sheet (#65) is drawn at 32 and so at 1:1.
- The ground tileset is laid in rows of `GROUND_TILESET_COLUMNS` (64) tiles, 2048 pixels, in the order a Phaser tileset counts them. At 32 pixels the one row 0016 describes would be 4320 pixels wide, past the 4096 every WebGL device can hold.

## Consequences

- New art is drawn at 32 pixels per metre. A sprite at another density is legal but looks out of place; the terrain generator tests check each sheet against its def.
- Doubling again would mean the same steps: the constants, the sheets, a camera that halves its zoom. Rules written in metres (the zoom, the names) need nothing.
- The zoom never goes below 1, so a canvas narrower than 640 device pixels (`PIXELS_PER_METRE` times `MIN_VISIBLE_METRES`) shows fewer than 20 metres: half what it showed at 16 pixels per metre. That is only a desktop window dragged very narrow; phones are 750 device pixels and up. A fractional zoom there would blur the art, so it is left as is; `zoom.test.ts` pins it.
- Textures take four times the memory per tile. The ground tileset is about 2048x96 pixels today; the sheets together are well under a megabyte.
