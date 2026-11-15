import { readCharacter, type Character } from '@novaland/sim';

/** Where the browser keeps the last character the player made. */
const CHARACTER_STORAGE_KEY = 'novaland.character';

/** The part of `localStorage` this module uses; tests pass a fake. */
export type CharacterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The character this browser remembers, or undefined when it remembers none
 * or what it holds is no longer a legal character (edited by hand, or made
 * for palettes that have changed since): the sim's own rule decides, so a
 * remembered character is never one the world would refuse. A browser that
 * denies storage remembers nothing.
 */
export function readRememberedCharacter(storage: CharacterStorage | undefined): Character | undefined {
  try {
    const stored = storage?.getItem(CHARACTER_STORAGE_KEY);
    return typeof stored === 'string' ? readCharacter(JSON.parse(stored)) : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers `character` for the next visit. A browser that denies storage just asks again next time. */
export function rememberCharacter(storage: CharacterStorage | undefined, character: Character): void {
  try {
    storage?.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(character));
  } catch {
    // Storage is full or denied: nothing to do but ask again on the next visit.
  }
}

/** The browser's own storage, or undefined where reading it throws (cookies blocked, a sandboxed frame). */
export function browserCharacterStorage(): CharacterStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const __testing__ = { CHARACTER_STORAGE_KEY };
