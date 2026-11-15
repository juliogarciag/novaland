import { characterPalettes, DefId, getDef, type Character, type CharacterLook } from '@novaland/sim';
import { spriteSheetUrl } from '../render/spriteUrl';
import { chooseCharacter } from './creatorScreen';
import { browserCharacterStorage, readRememberedCharacter, rememberCharacter } from './rememberedCharacter';

/** The address that opens the creator even when the browser remembers a character: `…/#creator`. */
export const CREATOR_HASH = '#creator';

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
  // The address goes back to the plain one, so a reload plays instead of opening the creator again.
  if (creatorAsked) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return character;
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
  const anyOf = (swatches: readonly unknown[]): number => Math.floor(Math.random() * swatches.length);
  return { skin: anyOf(characterPalettes.skin), hair: anyOf(characterPalettes.hair), clothes: anyOf(characterPalettes.clothes) };
}
