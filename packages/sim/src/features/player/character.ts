import { CHARACTER_PARTS, characterPalettes, MAX_NAME_CHARACTERS, MAX_NAME_CODE_POINTS, type CharacterPart } from './defs';

/** Which swatch of each palette a character wears: indexes into `characterPalettes` (defs.ts). */
export type CharacterLook = Readonly<Record<CharacterPart, number>>;

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
 * fillers, the combining grapheme joiner). Four invisible characters stay
 * legal because real spellings need them, each only where `MISPLACED_INVISIBLE`
 * allows: the zero-width joiner and non-joiner, and the two variation selectors
 * that pick an emoji's or a symbol's form.
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u2800]|(?!\u200c|\u200d|\ufe0e|\ufe0f)[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/**
 * One of the four legal invisible characters where it spells nothing: a
 * joiner that is not inside an emoji sequence or between two letters of a
 * word, a variation selector that does not follow the emoji, symbol or keycap
 * digit it selects a form of, or a combining mark with no letter to sit on.
 * Placed like this they would only make a name that looks blank, or one that
 * looks exactly like another player's.
 */
const MISPLACED_INVISIBLE =
  /(?<![\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])[\u200c\u200d]|[\u200c\u200d](?![\p{L}\p{Extended_Pictographic}])|(?<![\p{Extended_Pictographic}0-9#*])[\ufe0e\ufe0f]|(?:^|\p{Z})\p{M}/u;

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
 * cannot be one. A name is normalised, never trusted: composed (NFC), runs of
 * spaces collapsed to one, spaces around it removed. What is left must show
 * something, be at most MAX_NAME_CHARACTERS visible characters and
 * MAX_NAME_CODE_POINTS code points, hold only characters a name may hold
 * (`holdsOnlyNameCharacters`) and no pile of marks on one character. Reading
 * a name this returned gives the same name back. Never throws.
 */
export function readCharacterName(value: unknown): { readonly name: string } | { readonly problem: CharacterNameProblem } {
  if (typeof value !== 'string') return { problem: 'not-text' };
  if (value.length > MAX_RAW_NAME_LENGTH) return { problem: 'too-long' };
  const composed = value.normalize('NFC');
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
  return !FORBIDDEN_IN_NAME.test(text) && !MISPLACED_INVISIBLE.test(text);
}

/** True when `text` holds something that draws. */
export function showsSomething(text: string): boolean {
  return VISIBLE_IN_NAME.test(text);
}

/**
 * The character behind an arbitrary value, or undefined when it is not one:
 * exactly a `name` that `readCharacterName` accepts and a `look` holding
 * exactly one in-range palette index per part. The result is a fresh object
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
    },
  };
}

/** The code points of a string, in order. */
export function codePointsOf(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) as number);
}

/** True when `index` picks a swatch of the palette for `part`. */
export function isPaletteIndex(part: CharacterPart, index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < characterPalettes[part].length;
}

function readCharacterLook(value: unknown): CharacterLook | undefined {
  if (!hasExactlyKeys(value, [...CHARACTER_PARTS].sort())) return undefined;
  const { skin, hair, clothes } = value;
  if (!isPaletteIndex('skin', skin) || !isPaletteIndex('hair', hair) || !isPaletteIndex('clothes', clothes)) return undefined;
  return { skin, hair, clothes };
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
