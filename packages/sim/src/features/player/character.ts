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
  /** A control or other invisible formatting character (a tab, a line break, a text-direction override), or marks stacked on one letter. */
  | 'forbidden-character';

/** A string longer than this is refused before any Unicode work is done on it, so a huge value costs nothing. */
const MAX_RAW_NAME_LENGTH = 8 * MAX_NAME_CODE_POINTS;

/**
 * Characters no name may hold: controls (tabs and line breaks included), lone
 * surrogates, line and paragraph separators, and invisible formatting
 * characters such as text-direction overrides. The zero-width joiner and
 * non-joiner stay legal: emoji and several scripts are spelled with them.
 * Three or more combining marks in a row are refused too: no common spelling
 * needs them, and stacked they draw far outside the line a name label has.
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]|(?![\u200c\u200d])\p{Cf}|\p{M}{3,}/u;

const SPACE_RUNS = /\p{Zs}+/gu;

/** A fixed locale: where grapheme clusters break does not depend on it, and the sim must not read the machine's. */
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The name behind an arbitrary value, the way the sim stores it, or why it
 * cannot be one. A name is normalised, never trusted: composed (NFC), runs of
 * spaces collapsed to one, spaces around it removed. What is left must be 1
 * to MAX_NAME_CHARACTERS visible characters, at most MAX_NAME_CODE_POINTS code
 * points, and free of control characters, formatting characters and stacked
 * marks. Reading a name this
 * returned gives the same name back. Never throws.
 */
export function readCharacterName(value: unknown): { readonly name: string } | { readonly problem: CharacterNameProblem } {
  if (typeof value !== 'string') return { problem: 'not-text' };
  if (value.length > MAX_RAW_NAME_LENGTH) return { problem: 'too-long' };
  const composed = value.normalize('NFC');
  if (FORBIDDEN_IN_NAME.test(composed)) return { problem: 'forbidden-character' };
  const name = composed.replace(SPACE_RUNS, ' ').trim();
  if (name.length === 0) return { problem: 'empty' };
  if (codePointsOf(name).length > MAX_NAME_CODE_POINTS || visibleCharacterCount(name) > MAX_NAME_CHARACTERS) return { problem: 'too-long' };
  return { name };
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
    const read = readCharacterName(value['name']);
    const look = readCharacterLook(value['look']);
    if ('problem' in read || !look) return undefined;
    return { name: read.name, look };
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

function visibleCharacterCount(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}
