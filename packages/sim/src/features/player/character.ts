import { CHARACTER_PARTS, characterPalettes, characterShapes, choiceCount, LOOK_PARTS, MAX_NAME_CHARACTERS, MAX_NAME_CODE_POINTS, type LookPart } from './defs';

/** Which swatch of each palette and which shape of each list a character wears: indexes into `characterPalettes` and `characterShapes` (defs.ts). */
export type CharacterLook = Readonly<Record<LookPart, number>>;

/** What a player chooses before entering the world: a look and the name drawn above their head. */
export interface Character {
  readonly name: string;
  readonly look: CharacterLook;
}

/** Why a value cannot be a character's name. */
export type CharacterNameProblem =
  /** Not a string at all. */
  | 'not-text'
  /** Nothing left once the spaces around it are gone. */
  | 'empty'
  /** More than MAX_NAME_CHARACTERS visible characters, or more than MAX_NAME_CODE_POINTS code points. */
  | 'too-long'
  /** A character that draws as nothing or changes how the text around it draws (a tab, a line break, a text-direction override, a blank letter, a joiner out of place), or marks stacked on one letter. */
  | 'forbidden-character';

/** A string longer than this is refused before any Unicode work is done on it, so a huge value costs nothing. */
const MAX_RAW_NAME_LENGTH = 8 * MAX_NAME_CODE_POINTS;

/**
 * Characters no name may hold: controls (tabs and line breaks included), lone
 * surrogates, private-use characters, line and paragraph separators, the
 * braille blank, and every invisible character: formatting characters such as
 * text-direction overrides, and the letters that draw as nothing (the Hangul
 * fillers, the combining grapheme joiner, the object replacement character).
 * Unassigned code points are refused as well, since nobody can say what they
 * draw, except in the ranges reserved for emoji, so an emoji newer than this
 * engine's tables still passes. Three invisible characters stay legal because
 * real spellings need them, each only where `invisibleIsMisplaced` allows:
 * the zero-width joiner and non-joiner, and the emoji variation selector.
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u2800\ufffc]|(?!\u200c|\u200d|\ufe0f)[\p{Cf}\p{Default_Ignorable_Code_Point}]|(?!\p{Extended_Pictographic})\p{Cn}/u;

/** A combining mark with no letter to sit on: at the start, or after a space. */
const BARE_MARK = /(?:^|\p{Z})\p{M}/u;

/**
 * The flags of England, Scotland and Wales: a black flag, tag characters
 * spelling the region, and the tag that ends them. Tag characters are
 * invisible and refused everywhere else; inside one of these they are the
 * spelling of a flag, so the rule looks at the flag as its first character.
 */
const TAGGED_FLAG = /\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}/gu;

/** The emoji variation selector after an emoji that already draws as one: it selects nothing, so it is dropped when a name is read. */
const REDUNDANT_SELECTOR = /(?<=\p{Emoji_Presentation})\ufe0f/gu;

const ZERO_WIDTH_NON_JOINER = 0x200c;
const ZERO_WIDTH_JOINER = 0x200d;
const EMOJI_SELECTOR = 0xfe0f;
const KEYCAP = 0x20e3;

/** What a joiner may follow inside an emoji sequence: an emoji, its skin tone, or its selector. */
const BEFORE_EMOJI_JOINER = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const DRAWS_AS_EMOJI_ALREADY = /\p{Emoji_Presentation}/u;
const KEYCAP_BASE = /[0-9#*]/u;

/**
 * Letters, marks and digits of the scripts whose spelling uses the joiners:
 * the cursive ones, where a non-joiner breaks a connection, and the Indic
 * ones, where a joiner picks the form of a conjunct. Between two characters
 * of other scripts (Latin, Greek, Cyrillic, Han, kana, Hangul) a joiner
 * changes nothing on screen, so there it could only make a name that looks
 * exactly like another player's.
 */
const SPELLED_WITH_JOINERS =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u;

/** Something that draws: a name needs at least one. */
const VISIBLE_IN_NAME = /[^\p{M}\p{Z}\p{Default_Ignorable_Code_Point}]/u;

const SPACE_RUNS = /\p{Zs}+/gu;

const COMBINING_MARKS = /\p{M}/gu;

/** The general-purpose accents (the combining diacritical blocks): the ones that stack on any letter, which no spelling piles up. */
// eslint-disable-next-line no-misleading-character-class -- the class is meant to hold combining characters: it counts them.
const STACKING_ACCENTS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/gu;

/** Most general-purpose accents one visible character may still carry once composed. Vietnamese composes to none; a keycap carries one. */
const MAX_STACKING_ACCENTS = 2;

/** Most combining marks of any kind on one visible character. Burmese and Tibetan syllables carry four or five. */
const MAX_COMBINING_MARKS = 6;

/** A fixed locale: where grapheme clusters break does not depend on it, and the sim must not read the machine's. */
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The name behind an arbitrary value, the way the sim stores it, or why it
 * cannot be one. A name is normalised, never trusted: composed (NFC), emoji
 * selectors that select nothing dropped, runs of spaces collapsed to one,
 * spaces around it removed. What is left must show
 * something, be at most MAX_NAME_CHARACTERS visible characters and
 * MAX_NAME_CODE_POINTS code points, hold only characters a name may hold
 * (`holdsOnlyNameCharacters`) and no pile of marks on one character. Reading
 * a name this returned gives the same name back. Never throws.
 */
export function readCharacterName(value: unknown): { readonly name: string } | { readonly problem: CharacterNameProblem } {
  if (typeof value !== 'string') return { problem: 'not-text' };
  if (value.length > MAX_RAW_NAME_LENGTH) return { problem: 'too-long' };
  const composed = value.normalize('NFC').replace(REDUNDANT_SELECTOR, '');
  if (!holdsOnlyNameCharacters(composed)) return { problem: 'forbidden-character' };
  const name = composed.replace(SPACE_RUNS, ' ').trim();
  if (!VISIBLE_IN_NAME.test(name)) return { problem: 'empty' };
  const visibleCharacters = Array.from(graphemes.segment(name), (grapheme) => grapheme.segment);
  if (codePointsOf(name).length > MAX_NAME_CODE_POINTS || visibleCharacters.length > MAX_NAME_CHARACTERS) return { problem: 'too-long' };
  if (visibleCharacters.some(carriesStackedMarks)) return { problem: 'forbidden-character' };
  return { name };
}

/**
 * True when every character of `text` is one a name may hold, where it may
 * hold it. This is the part of the rule that protects whoever draws the name,
 * and it reads the same on every engine: no counting of visible characters,
 * which newer Unicode tables can count differently. A view asks it about a
 * name that came off the network (`getCharacter`).
 */
export function holdsOnlyNameCharacters(text: string): boolean {
  const withoutFlagTags = text.replace(TAGGED_FLAG, '\u{1f3f4}');
  return !FORBIDDEN_IN_NAME.test(withoutFlagTags) && !BARE_MARK.test(withoutFlagTags) && !invisibleIsMisplaced(withoutFlagTags);
}

/**
 * True when one of the three legal invisible characters sits where it spells
 * nothing, so that it could only make a name look blank or exactly like
 * another player's. A joiner belongs inside an emoji sequence (after an
 * emoji, a skin tone or a selector and before an emoji) or between two
 * characters of a script that is spelled with joiners. The emoji selector
 * belongs after a symbol that would otherwise draw as text, or in a keycap
 * (a digit, the selector, the keycap mark).
 */
function invisibleIsMisplaced(text: string): boolean {
  const characters = Array.from(text);
  return characters.some((character, index) => {
    const codePoint = character.codePointAt(0);
    const before = characters[index - 1] ?? '';
    const after = characters[index + 1] ?? '';
    if (codePoint === ZERO_WIDTH_JOINER || codePoint === ZERO_WIDTH_NON_JOINER) {
      const joinsEmoji = codePoint === ZERO_WIDTH_JOINER && BEFORE_EMOJI_JOINER.test(before) && EMOJI.test(after);
      return !joinsEmoji && !(SPELLED_WITH_JOINERS.test(before) && SPELLED_WITH_JOINERS.test(after));
    }
    if (codePoint === EMOJI_SELECTOR) {
      if (KEYCAP_BASE.test(before)) return after.codePointAt(0) !== KEYCAP;
      return !EMOJI.test(before) || DRAWS_AS_EMOJI_ALREADY.test(before);
    }
    return false;
  });
}

/** True when `text` holds something that draws. */
export function showsSomething(text: string): boolean {
  return VISIBLE_IN_NAME.test(text);
}

/**
 * The character behind an arbitrary value, or undefined when it is not one:
 * exactly a `name` that `readCharacterName` accepts and a `look` holding
 * exactly one in-range index per part (`LOOK_PARTS`). The result is a fresh object
 * with the normalised name, so nothing of the value it was read from travels
 * on. This is the one rule for what a legal character is: the join handler,
 * the server's inbound gate and the creator screen all ask it. Never throws.
 */
export function readCharacter(value: unknown): Character | undefined {
  try {
    if (!hasExactlyKeys(value, ['look', 'name'])) return undefined;
    const nameResult = readCharacterName(value['name']);
    const look = readCharacterLook(value['look']);
    if ('problem' in nameResult || !look) return undefined;
    return { name: nameResult.name, look };
  } catch {
    // A decoded message is plain data, but a throwing accessor must still not reach the sim.
    return undefined;
  }
}

/** True when two characters are the same name in the same look: nothing a player or the world could tell apart. */
export function sameCharacter(one: Character, other: Character): boolean {
  return one.name === other.name && LOOK_PARTS.every((part) => one.look[part] === other.look[part]);
}

/**
 * A legal character for a seat nobody made one for: "Guest 1" for slot 0 and
 * so on, in colours that differ from seat to seat. Scripts, tests and the dev
 * key that seats extra players use it.
 */
export function guestCharacter(slot: number): Character {
  const seat = Number.isSafeInteger(slot) && slot >= 0 ? slot : 0;
  return {
    name: `Guest ${seat + 1}`,
    look: {
      skin: seat % characterPalettes.skin.length,
      hair: (seat * 3 + 1) % characterPalettes.hair.length,
      clothes: seat % characterPalettes.clothes.length,
      body: seat % characterShapes.body.length,
      hairStyle: seat % characterShapes.hairStyle.length,
    },
  };
}

/** The code points of a string, in order. */
export function codePointsOf(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) as number);
}

/**
 * The character a browser remembered, or undefined when it is not one. A
 * character remembered before body types and hairstyles existed (#66) has a
 * look without `body` and `hairStyle`: it reads with the first entry of each,
 * what every player wore then, instead of sending the player back to the
 * creator. Anything else is judged by `readCharacter` as it is. Never throws.
 */
export function readRememberedCharacter(value: unknown): Character | undefined {
  try {
    if (!hasExactlyKeys(value, ['look', 'name']) || !hasExactlyKeys(value['look'], [...CHARACTER_PARTS].sort())) return readCharacter(value);
    return readCharacter({ name: value['name'], look: { ...value['look'], body: 0, hairStyle: 0 } });
  } catch {
    return undefined;
  }
}

/** True when `index` picks one of the choices for `part`: a swatch of a palette or a shape of a list. */
export function isLookIndex(part: LookPart, index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < choiceCount(part);
}

function readCharacterLook(value: unknown): CharacterLook | undefined {
  if (!hasExactlyKeys(value, [...LOOK_PARTS].sort())) return undefined;
  const { skin, hair, clothes, body, hairStyle } = value;
  if (!isLookIndex('skin', skin) || !isLookIndex('hair', hair) || !isLookIndex('clothes', clothes) || !isLookIndex('body', body) || !isLookIndex('hairStyle', hairStyle)) return undefined;
  return { skin, hair, clothes, body, hairStyle };
}

/** True when `value` is a plain object whose own keys are exactly `sortedKeys`. */
function hasExactlyKeys(value: unknown, sortedKeys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === sortedKeys.length && keys.every((key, index) => key === sortedKeys[index]);
}

/** True when one visible character carries more marks than any spelling puts on one. */
function carriesStackedMarks(visibleCharacter: string): boolean {
  return (visibleCharacter.match(STACKING_ACCENTS)?.length ?? 0) > MAX_STACKING_ACCENTS || (visibleCharacter.match(COMBINING_MARKS)?.length ?? 0) > MAX_COMBINING_MARKS;
}
