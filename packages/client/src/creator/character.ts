import { characterPalettes, DefId, getDef, type Character, type CharacterLook } from '@novaland/sim';
import { spriteSheetUrl } from '../render/spriteUrl';
import { chooseCharacter } from './creatorScreen';
import { browserCharacterStorage, readRememberedCharacter, rememberCharacter } from './rememberedCharacter';

/** The address that opens the creator even when the browser remembers a character: `…/#creator`. */
const CREATOR_HASH = '#creator';

/**
 * The character this visit is played as. A browser that remembers one goes
 * straight in with it; a first visit, or the address `#creator`, shows the
 * creator first (starting from the remembered character when there is one)
 * and remembers what the player makes.
 */
export async function characterForThisVisit(): Promise<Character> {
  const storage = browserCharacterStorage();
  const remembered = readRememberedCharacter(storage);
  const creatorAsked = window.location.hash === CREATOR_HASH;
  if (remembered && !creatorAsked) return remembered;
  const sprite = getDef(DefId.Player).sprite;
  const character = await chooseCharacter(document.body, {
    initial: remembered ?? { name: '', look: randomLook() },
    previewSheet: { url: spriteSheetUrl(sprite?.key ?? 'player'), frameWidth: sprite?.frameWidth ?? 16, frameHeight: sprite?.frameHeight ?? 24 },
  });
  rememberCharacter(storage, character);
  if (creatorAsked) forgetCreatorWasAsked();
  return character;
}

/**
 * Opens the creator when `#creator` is added to the address of a page that is
 * already playing: the page loads again, as it does for the Change character
 * button. Call once, when the game has started.
 */
export function openCreatorWhenAddressAsks(): void {
  window.addEventListener('hashchange', () => {
    if (window.location.hash === CREATOR_HASH) window.location.reload();
  });
}

/** Leaves the world for the creator: the page loads again at `#creator`, and the next join is the new character. */
export function openCreator(): void {
  window.location.hash = CREATOR_HASH;
  window.location.reload();
}

/**
 * The button that takes a player who is in the world back to the creator.
 * Plain DOM in a corner, like the screens. It never keeps the keyboard:
 * the game's keys must go to the game.
 */
export function addChangeCharacterButton(parent: HTMLElement): void {
  const button = document.createElement('button');
  button.id = 'change-character';
  button.type = 'button';
  button.textContent = 'Change character';
  button.tabIndex = -1;
  button.addEventListener('click', openCreator);
  parent.append(button);
}

/** A suggestion for a first visit, so two new players rarely start out looking the same. Only a starting point: the player picks. */
function randomLook(): CharacterLook {
  const randomIndexOf = (swatches: readonly unknown[]): number => Math.floor(Math.random() * swatches.length);
  return { skin: randomIndexOf(characterPalettes.skin), hair: randomIndexOf(characterPalettes.hair), clothes: randomIndexOf(characterPalettes.clothes) };
}

/**
 * Puts the plain address back, so a reload plays instead of opening the
 * creator again. Built from the whole URL, never from the path alone (a path
 * that starts with two slashes would read as another site and throw), and a
 * browser that refuses is left as it is: a stale address must not stop the game.
 */
function forgetCreatorWasAsked(): void {
  try {
    const address = new URL(window.location.href);
    address.hash = '';
    window.history.replaceState(null, '', address);
  } catch {
    // The address keeps its #creator: the next reload opens the creator once more, nothing worse.
  }
}
