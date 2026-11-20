# 0018 - Gender and hairstyle: two shape choices in the look, drawn as layers, with old remembered characters read with defaults

Status: accepted. Date: 2026-11-19. Supersedes three parts of [0015](0015-player-character.md): what a look holds, the rule that a remembered character the sim refuses is asked for again, and the one recoloured sheet per look. Builds on ticket #65's 32x48 sheet, which paints the body and the hair as separate layers. Ticket #66.

## Context

Players pick colours (skin, hair, clothes) and a name (0015). Ticket #66 lets them shape their character too. The first version offered a body type (straight or curvy) and a hairstyle as two choices with no gender label. Playing it, the human preferred a gender choice, and no difference in body at all. A gender gives the face lashes (female) or not (male), and it comes with a suggested hairstyle the player can still change.

Three things 0015 decided stop being true:

- 0015 says a look is "exactly one in-range palette index per part" and `PlayerLook { skin, hair, clothes }`. A gender and a hairstyle are not colours.
- 0015 says a remembered character that is no longer legal is asked for again. Every character a browser remembers today has no gender and no hairstyle, so under that rule every returning player would land in the creator once more.
- 0015 says the renderer makes one texture per look by swapping the template colours of `sprites/player.png`. A single sheet can only hold every pairing of a gender and a hairstyle by painting each one, so every new hairstyle would multiply the sheets.

## Decision

**A look holds two shape indexes beside the three colour indexes.** `PlayerLook` gains `gender` and `hairStyle`, indexes into `characterShapes.gender` (`male`, `female`) and `characterShapes.hairStyle` (`short`, `long`) in `features/player/defs.ts`. Each entry has a name and the sprite key of its layer sheet. A gender also has a `defaultHairStyle`, an index into the hairstyles: short for male, long for female. As with the palettes, an index is forever: an entry is added at the end and never moved or removed, and a test pins the order. The look's parts are `LOOK_PARTS`: the colours (`CHARACTER_PARTS`) then the shapes (`CHARACTER_SHAPE_PARTS`).

**A gender suggests a hairstyle; it does not impose one.** When the player picks a gender in the creator, the creator picks that gender's `defaultHairStyle` and shows it picked, and the player can then pick any other. The suggestion is content from the sim, not a rule. `readCharacter` accepts any hairstyle with any gender, and the world never changes a hairstyle on its own.

**`readCharacter` stays strict.** A look must hold exactly the five indexes, each in range. The join, `player/change-character` and the server's gate all ask it, so they refuse a join or a change without a gender and a hairstyle like any other illegal one. On a replica, `getCharacter` reads an out-of-range index as the first entry, as it already did for colours. `WIRE_PROTOCOL` goes from 4 to 5: a page built before this change would send looks the server refuses, so it is told to reload instead.

**A remembered character from before this change reads with defaults.** `readRememberedCharacter(value)` (sim, exported) takes a value that is exactly `{ name, look: { skin, hair, clothes } }`, gives it the first gender and the first hairstyle, then asks `readCharacter`. Every other value goes to `readCharacter` unchanged, so anything else that is not legal is still asked for again. The client's `readRememberedCharacter(storage)` calls it. The first entry of each list must therefore stay what every player wore before #66: the male body and short hair that `player.png` has always held. Only the browser's memory gets this leniency. The wire never does: the server refuses an old look, and the protocol bump means no current page sends one.

**The client draws a look from two layer sheets.** The generator (`tools/generate-player-sheet.mjs`) writes one unoutlined body sheet per gender (`player-body-<gender>.png`). It holds the legs, torso and arms, plus the face with its eyebrows and, for female, lashes. Both genders have the same body: the lashes are the only pixels that differ, and a test holds that. The generator also writes one hair sheet per hairstyle (`player-hair-<name>.png`), in hair colours only, placed by the head. All of them use #65's frame layout and template colours. It still writes `player.png` (male body, short hair, outlined), which the def names. For each look the client lays the hairstyle's sheet over the gender's body sheet, outlines the two together and swaps the template colours (`paintFigure`, `render/characterSheet.ts`). The result is still one texture per look, now keyed by all five indexes. The creator's preview runs the same function on the first frame. A test checks, for every pairing, that the client's layering matches byte for byte what the generator paints for the same pair. If a layer sheet is missing, the renderer warns and falls back to recolouring `player.png`.

**A first visit starts from a fixed look, `DEFAULT_LOOK`** (sim content, next to the lists): male with his suggested short hair, honey skin, black hair and sky-blue clothes. It replaces the random look the creator used to suggest, so every new player starts from the same figure and changes what they want.

**The creator offers both choices as named buttons**, above the colour swatches: Gender, then Hairstyle. They are radio groups like the swatches, labelled from `characterShapes`.

## Consequences

- A new hairstyle is a stencil set in the generator, an entry at the end of `characterShapes.hairStyle` with its sheet key, and the generated sheet. Nothing else changes: the creator, the renderer and the validation all read the lists. A gender's suggested hairstyle is one number in its entry.
- Since the hairstyle is free, a male character with long hair or a female one with short hair is a legal, ordinary look. A gender changes nothing about the body but the lashes; a later wish for different builds is a new choice of its own, not a change to gender.
- A new kind of choice (a hat, a beard) is a new list in `characterShapes` and one more field in `PlayerLook`. That means another protocol bump and another default for remembered characters.
- Hair can fall past the head, over the shoulders and down the back, but it is always drawn over the body. Hair that goes behind the body (seen over the far shoulder from the front) would need a second, behind-the-body layer per hairstyle.
- The first time a look is seen, building its texture costs a second canvas read and an outline pass. With at most five players, that is a handful of 128x192 passes.
- A look now costs five numbers instead of three in a full state. A change of character is still one delta of `PlayerLook` and `PlayerName`.
- A server older than this change refuses a page built after it (protocol 5), and a newer server refuses older pages. Both sides deploy together, as for every bump.
