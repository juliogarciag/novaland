# 0019 - The world's art back at 16 pixels per metre, gender and hairstyle kept

Status: accepted. Date: 2026-11-24. Supersedes [0017](0017-art-at-32-pixels-per-metre.md) as a whole, and restores the 16 of [0011](0011-ground-tile-textures.md) and the single tileset row of [0016](0016-edge-tiles.md) that 0017 had replaced. Changes the parts of [0018](0018-gender-and-hairstyle.md) listed below; the rest of 0018 stands. Ticket #72.

## Context

Tickets #65, #64 and #66 doubled the art: a 32x48 player, 32-pixel tiles, and a gender and a hairstyle drawn as layers on the 32x48 sheet (0017, 0018). The human played that version and preferred the earlier look: 16x24 characters on 16-pixel tiles, the art as it was at `c466e78`. The finer pixels were not worth it; the coarse, readable figures were what they liked. They wanted to keep the gender and hairstyle choice, redrawn at the lower resolution. So this is not a revert of the three tickets: a revert would take the choice away too.

## Decision

- **One metre is 16 texture pixels again.** `PIXELS_PER_METRE` (`client/src/render/units.ts`), every terrain sprite's `tilePixels` and `pixelsPerMetre` (`features/terrain/defs.ts`) and the player's sprite def are 16. The terrain sheets, their generators, the ground tileset (one row again, as 0016 describes: 135 tiles, 2160 pixels), the name labels and the camera's zoom are what they were at `c466e78`, file for file. The zoom rule never changed: it is in metres, so at 16 pixels a screen gets twice the zoom it got at 32 and sees the same metres, or less where 0017 had to round down.
- **The player is 16x24 again, in the style of the generator at `c466e78`:** the same rectangles, one-pixel eyes, one colour per material and a shade only for the clothes. `player.png` (male, short hair) is that sheet, byte for byte.
- **Gender and hairstyle stay, as 0018 describes them, redrawn at 16x24.** The generator still writes one body sheet per gender and one hair sheet per hairstyle, and the client still lays the hair over the body, outlines them together and recolours them (`paintFigure`). `PlayerLook`, `characterShapes`, `DEFAULT_LOOK`, `readCharacter`, the remembered characters, the creator and its turning keys and `WIRE_PROTOCOL` (5) do not change. At this size a difference is a pixel or two:
  - The skull is painted whole in skin on the body layer, so taking the hair away leaves a bald head and any hairstyle goes on any body.
  - Short hair is the hair of `c466e78`. Long hair is that plus the sides falling past the jaw to the shoulders from the front, and, from behind and in profile, most of the back of the head's width carried down past the nape into the first two rows of the shirt.
  - Both genders have the same body. The female eyes have a lash: one pixel of the eyes' colour on top of each eye, so the eye reads taller. A pixel off the outer corner, as at 32, reads as a frown at 16.
- **Recolouring goes back to four template colours:** skin, hair, clothes and the clothes' shade, which the client still derives from the picked clothes colour (`shadeOf`). The skin and hair shades and the hair and clothes highlights of 0018's sheets are gone, and with them `highlightOf`.

## What changes in 0018

- Its layer sheets are 16x24 frames (a sheet is 64x96), not #65's 32x48.
- The face on the body sheet has no eyebrows: the 16x24 face never had any. Lashes are a pixel on top of each eye, not off the outer corner.
- The hair layer is one colour, the hair's, with no shade or highlight.
- Its cost note: a new look builds a 64x96 texture, a quarter of the 128x192 it said.

## Consequences

- New art is drawn at 16 pixels per metre. A character sprite at another density still draws at the right size, scaled by `PIXELS_PER_METRE / pixelsPerMetre`, but looks out of place.
- The one-row tileset has 0016's ceiling again: past 256 ground tiles it is wider than the 4096 pixels every WebGL device can hold. A test (`groundTiles.test.ts`) fails before that happens; the rows layout of 0017 is the way out, and it does not depend on the pixels per metre.
- A test keeps every terrain sprite at `PIXELS_PER_METRE`, so a def drawn at another density fails rather than drawing at the wrong size.
- A character saved by the 32-pixel version is the same five indexes and loads unchanged; only how it is drawn changed.
- A new hairstyle is a list of rectangles per direction in the generator (the right profile is the left one mirrored), an entry at the end of `characterShapes.hairStyle`, and the generated sheet.
- If finer art comes back, 0017 is the map: the constants, the sheets and a camera that halves its zoom.
