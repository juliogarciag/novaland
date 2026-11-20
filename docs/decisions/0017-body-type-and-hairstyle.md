# 0017 - Body type and hairstyle: two shape choices in the look, drawn as layers, with old remembered characters read with defaults

Status: accepted. Date: 2026-11-19. Supersedes three parts of [0015](0015-player-character.md): what a look holds, the rule that a remembered character the sim refuses is asked for again, and the one recoloured sheet per look. Builds on ticket #65's 32x48 sheet with its body and hair painted as separate layers. Ticket #66.

## Context

Players pick colours (skin, hair, clothes) and a name (0015). Ticket #66 lets them pick a body type and a hairstyle as well, and the human chose two independent choices over a gender switch: any hairstyle goes on any body, and nothing in the game labels either choice with a gender. The ticket starts with two body types that differ in build and silhouette (shoulders, waist and hips, and lashes on the face) and three hairstyles.

Three things 0015 decided stop being true:

- 0015 says a look is "exactly one in-range palette index per part" and `PlayerLook { skin, hair, clothes }`. Body type and hairstyle are not colours.
- 0015 says a remembered character that is no longer legal is asked for again. Every character a browser remembers today has no body type and no hairstyle, so under that rule every returning player would land in the creator once more.
- 0015 says the renderer makes one texture per look by swapping the template colours of `sprites/player.png`. One sheet cannot hold every pairing of a body and a hairstyle without painting all of them, and each new body type or hairstyle would multiply the sheets.

## Decision

**A look holds two shape indexes beside the three colour indexes.** `PlayerLook` gains `body` and `hairStyle`, indexes into `characterShapes.body` and `characterShapes.hairStyle` (`features/player/defs.ts`). Each entry is a name and the sprite key of its layer sheet. Like the palettes, an index is forever: an entry is added at the end and never moved or removed, and a test pins the order. The look's parts are `LOOK_PARTS`: the colours (`CHARACTER_PARTS`) then the shapes (`CHARACTER_SHAPE_PARTS`). The names are about shape only: the body types are `straight` and `curvy`, the hairstyles `short`, `long` and `tied back`.

**`readCharacter` stays strict.** A look must hold exactly the five indexes, each in range. The join, `player/change-character` and the server's gate all ask it, so a join or a change without a body type and a hairstyle is refused like any other illegal one. `getCharacter` reads an index out of range on a replica as the first entry, as it already did for colours. `WIRE_PROTOCOL` goes from 4 to 5: a page built before this change would send looks the server refuses, so it is told to reload instead.

**A remembered character from before this change reads with defaults.** `readRememberedCharacter(value)` (sim, exported) gives a value that is exactly `{ name, look: { skin, hair, clothes } }` the first body type and the first hairstyle, then asks `readCharacter`. Every other value goes to `readCharacter` as it is, so anything else that is not legal is still asked for again. The client's `readRememberedCharacter(storage)` calls it. The first entry of each list must therefore stay what every player wore before #66: the straight body and the short hair that `player.png` has always held. Only the browser's memory gets this leniency. The wire never does: the server refuses an old look, and the protocol bump makes sure no current page sends one.

**The client draws a look from two layer sheets.** The generator (`tools/generate-player-sheet.mjs`) writes one unoutlined sheet per body type (`player-body-<name>.png`: legs, torso, arms, the face with its eyebrows and, for the curvy body, lashes) and one per hairstyle (`player-hair-<name>.png`: only hair colours, placed by the head, which every body type carries in the same place), all in #65's frame layout and template colours. It still writes `player.png`, the first body type with the first hairstyle, outlined, which the def names. For each look the client lays the hairstyle's sheet over the body type's sheet, outlines the two together and swaps the template colours (`paintFigure`, `render/characterSheet.ts`). The result is one texture per look, as before, keyed by all five indexes. The creator's preview runs the same function on the first frame. A test checks that what the client lays together is byte for byte what the generator paints for the same pair, for every pairing. If a layer sheet is missing, the renderer falls back to recolouring `player.png`.

**The creator offers both choices as named buttons**, above the colour swatches. They are radio groups like the swatches, labelled from `characterShapes`.

## Consequences

- A new body type or hairstyle is a stencil set in the generator, an entry at the end of `characterShapes` with its sheet key, and the generated sheet. No other change is needed: the creator, the renderer and the validation read the lists. A new kind of choice (a hat, a beard) is a new list in `characterShapes` and one more field in `PlayerLook`, which means another protocol bump and another default for remembered characters.
- Hair can fall past the head, over the shoulders and the back, but it is always drawn over the body. A hairstyle that has to go behind the body (hair seen over the far shoulder from the front) would need a second, behind-the-body layer per hairstyle.
- Building a look's texture costs a second canvas read and an outline pass the first time that look is seen. There are at most five players, so this is a handful of 128x192 passes.
- Five players' looks now cost five numbers each in a full state instead of three. A change of character is still one delta of `PlayerLook` and `PlayerName`.
- A server older than this change refuses a page built after it (protocol 5), and a newer server refuses older pages. Both sides deploy together, as for every bump.
- The `straight` and `curvy` names describe shapes. A later ticket that renames them changes only the `name` (what the creator shows); the index and the sheet key stay.
