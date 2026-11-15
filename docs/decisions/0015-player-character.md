# 0015 - The player's character: a look as palette indexes, a name as code points, both chosen by the player and judged by the sim

Status: accepted. Date: 2026-11-15. Builds on [0001](0001-ecs.md) (components hold numbers; rich data lives in defs), [0004](0004-multiplayer-netcode.md) and [0005](0005-world-room-join.md) (world states and the join), and [0012](0012-client-side-prediction.md) (the wire protocol version). Ticket #54. It replaces one line of 0004's context: players no longer get a random avatar.

## Context

Until now the sim dressed a joining player: `player/join` carried a slot only and the sim picked one of eight avatar defs through its rng. Ticket #54 gives the choice to the player: a skin, a hair and a clothes colour from small fixed palettes, and a name of at most 20 characters that everyone sees above the character.

The look is easy: three small numbers. The name is the hard part. It is free text, per entity, chosen at run time, and three rules meet on it:

- Components hold numbers only (rule 6). Text has so far lived in defs, which are static and keyed by a `defId`: a name typed by a player cannot be a def.
- All state is in the snapshot (rule 3) and a replica is filled from world states, which carry component fields and nothing else (0004). Anything kept beside the components would need its own place in the snapshot, the world state, the delta, the replica and the prediction.
- Commands come from the network (rule 11). A name is the first thing a stranger types that every other player's screen draws.

Three places for the name were on the table:

1. **A string table in the sim**: a map from entity id to string, beside the components. It reads naturally, but it is a second kind of state. `SimSnapshot`, `WorldState`, the delta, `restore`, the replica's validation and `adoptEntity` would each grow a branch for it, and every one of those is a boundary that today only ever sees numbers.
2. **Outside the sim**: the server keeps names per seat and sends them in their own message. The sim stays numeric, but the name is then not in the snapshot, a replay does not have it, and the client joins two sources by slot.
3. **In a component, as numbers**: one field per code point, under a fixed limit.

## Decision

**A character is a look and a name, and both live in components.**

- `PlayerLook { skin, hair, clothes }` holds indexes into `characterPalettes` (`features/player/defs.ts`). The palettes are data; an index is forever, like a def id, because browsers remember them: a swatch is added at the end, never moved or removed.
- `PlayerName` holds the name as numbers: `length`, then `codePoint00` to `codePoint39`, zero past the end. It is written once, when the player spawns, and every field is written so nothing of an earlier holder of the entity id is left.
- Every player wears one def, `PlayerDefId.Player` (9). Ids 1 to 8, the eight fixed avatars, are retired and stay out of use.

This is option 3. Storing and replicating the name changed nothing in `core`: the name is in every snapshot, travels in full states, travels once in a delta (a component is only sent when one of its fields changes, and a name never does), reaches a replica through the validation that already exists, and is copied into the prediction by `adoptEntity` with the rest of the player. The cost is 41 numeric fields per player in a full state, about 700 bytes of JSON each, on the welcome and on a resync only.

**One rule says what a legal character is, and it lives in the sim**: `readCharacter(value)` and `readCharacterName(value)` (`features/player/character.ts`, exported from the package entry).

- A name is normalised, never trusted: composed (NFC), runs of spaces collapsed to one, outer spaces removed. What is left must be 1 to `MAX_NAME_CHARACTERS` (20) user-visible characters, counted as grapheme clusters with `Intl.Segmenter`, so an accented letter or an emoji counts once, and at most `MAX_NAME_CODE_POINTS` (40) code points, which is what the component stores.
- A name must show something and must not be able to pass for another through an invisible character. Refused: control characters, lone surrogates, private-use characters, line separators, unassigned code points outside the ranges reserved for emoji, and every invisible character (text-direction overrides, the blank Hangul fillers, the combining grapheme joiner, the braille blank, the object replacement character, the text variation selector). Three invisible characters stay because real spellings need them, each only in its place: the zero-width joiner inside an emoji sequence; either joiner between two characters of a script that is spelled with them (Arabic, Syriac, N'Ko, Mongolian and the Indic scripts), never between Latin, Greek, Cyrillic, Han, kana or Hangul, where it changes no pixel; and the emoji variation selector after a symbol that would otherwise draw as text, or in a keycap. A selector after an emoji that already draws as one selects nothing and is dropped when the name is read. Tag characters are legal only as the spelling of a flag (England, Scotland, Wales). A combining mark needs a letter to sit on, and one visible character carries at most two general-purpose accents after composition and six marks of any kind (Burmese and Tibetan syllables carry four or five).
- A look is exactly one in-range palette index per part.
- The value must be exactly `{ name, look }`. The result is a fresh object, so nothing else of what was read travels on.
- Reading what it returned gives the same thing back, and it never throws.

Everyone asks that one rule: the `player/join` handler (a join whose character it refuses is ignored), the server's inbound gate, the creator screen (to explain why a name is refused) and the browser's remembered character (one that is no longer legal is asked for again).

**The join carries the character.** `JoinCommand` gains `character`, and `JoinOptions` (the options of the Colyseus join) gains `character` next to `protocol`. The room reads the options at the edge (the options as a whole may not exceed `MAX_JOIN_OPTIONS_BYTES`, which leaves room for the small fields other tickets add; then `readJoinCharacter` asks the rule) and refuses a join without a legal character with `JOIN_REFUSAL.invalidCharacter` before it claims a seat, so the sim never holds a session without a player. The command carries what the rule returned, never the options. `WIRE_PROTOCOL` goes from 3 to 4: a page built before this change is told to reload instead of being refused for a character it never sent.

**Reading a character back is a view query**, `getCharacter(handle, eid)`. On a replica the numbers came from the network, so the query returns something safe to draw whatever they are: a palette index out of range reads as the first swatch, and a name reads as `?` when it holds a character no name may hold, shows nothing or has spaces around it. The read asks only that part of the rule (`holdsOnlyNameCharacters`), not the count of visible characters: the sim that stored the name counted with its own Unicode tables, and a browser with other tables must not turn a legal name into `?`.

**The client draws and remembers; it decides nothing.**

- The sheet `sprites/player.png` is painted in fixed template colours. The renderer makes one texture per look by swapping those colours for the look's (`render/characterSheet.ts`), so two players with the same look share a texture.
- The name is a text object above the character in a pixel font (Tiny5, bundled with the client), sized so one pixel of a letter is a whole number of device pixels, a little finer than a pixel of the world: it is rendered for the camera's whole-number zoom and scaled back by it, so the letters are blocky like the art and a glyph the pixel font lacks (an emoji, another script) falls back to the system's font and stays sharp. Only the client knows the font, so the client bounds what a legal name can cover: a name wider than about twenty wide letters is drawn smaller.
- The creator screen is plain DOM shown before the game exists, solo and online, and before anything is sent to a server. The browser keeps the last character in `localStorage` under `novaland.character`; a returning player goes straight in. `#creator` in the address, or the Change character button, opens the creator again, and the page loads fresh so the next join is the new character.

## Consequences

- Text a player types is stored as code points under a fixed limit. The next free-text field (a chat line, a sign) follows the same pattern or supersedes this ADR; it does not add a second kind of state.
- A name cannot change after the join without a new command. Changing character today is leaving and joining again, which the Change character button does.
- The rule depends on the Unicode tables of the engine that runs it (`normalize`, `\p{…}` classes, `Intl.Segmenter`). Online that is the server's Node, the only authority. A replay on an engine with other tables could count a recently added emoji differently; the stored result is plain code points and does not change. A browser with other tables than the server can disagree with it in the creator: a name the creator accepts may be refused by the server, and the page then shows the character-refused screen, which leads back to the creator.
- Names are not unique and look-alikes from other scripts are legal (the rule composes, it does not fold confusable letters). Nothing trusts a name today; a feature that does (an admin tag, chat moderation) needs its own rule first.
- Unassigned code points are refused, and what is unassigned depends on the engine's tables: a letter added to Unicode after the server's Node was built is refused until Node is updated. The ranges reserved for emoji are exempt, so a new emoji passes.
- The rule was checked against what a browser draws (every accepted code point alone and inside a plain name, in the label's font, on macOS Chromium), which is how the object replacement character was found. Fonts differ by platform, so another platform may draw some legal character blank; such a find is one more entry in the forbidden set.
- A join no longer draws from the rng for the look, so the same seed and joins give other spawn tiles than before this change. Nothing persisted depended on them.
- Defs 1 to 8 and their eight sheets are gone. A snapshot or world state from before this change points at defs that no longer exist; there is none to keep, and the protocol bump refuses old pages.
- The join's options are read field by field, under one size limit for all of them. Another ticket that adds a field (#55 adds a player token) adds its own reader next to `readJoinCharacter`; neither reader refuses the other's field, and the field must fit the shared limit or raise it.
- The verification template makes its browser contexts returning players (`rememberCharacter`), because a page without a remembered character now stops at the creator.
