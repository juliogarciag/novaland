import { characterPalettes, DefId, getDef, type Character, type CharacterLook } from '@novaland/sim';
import { spriteSheetUrl } from '../render/spriteUrl';
import { changeCharacter, chooseCharacter, sameCharacter, type PreviewSheet } from './creatorScreen';
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
  const character = await chooseCharacter(document.body, { initial: remembered ?? { name: '', look: randomLook() }, previewSheet: playerPreviewSheet() });
  rememberCharacter(storage, character);
  if (creatorAsked) forgetCreatorWasAsked();
  return character;
}

/**
 * What `#creator` in the address does once the player is in the world; until
 * then the page loads again and the creator shows before the join.
 */
let openCreatorOverGame: (() => void) | undefined;

/**
 * Opens the creator when `#creator` is added to the address of a page that
 * already has its character: over the game when the player is in the world,
 * else (a connection screen is up) by loading the page again. Call once, when
 * this visit's character is known (the creator has cleaned its own address up by then).
 */
export function openCreatorWhenAddressAsks(): void {
  window.addEventListener('hashchange', () => {
    if (window.location.hash !== CREATOR_HASH) return;
    if (!openCreatorOverGame) {
      window.location.reload();
      return;
    }
    forgetCreatorWasAsked();
    openCreatorOverGame();
  });
}

/** Leaves for the creator from a screen that is not the world: the page loads again at `#creator`, and the next join is the new character. */
export function openCreator(): void {
  window.location.hash = CREATOR_HASH;
  window.location.reload();
}

export interface ChangeCharacterOptions {
  /** The character the player entered the world as. */
  readonly playing: Character;
  /** Makes the player in the world `character`, where it stands. */
  changeTo(character: Character): void;
  /** Takes the keyboard away from the game while the creator is open (true) and gives it back (false): the name is typed with the keys that walk. */
  holdGameKeys(held: boolean): void;
}

/**
 * The button that opens the creator for a player who is in the world, over
 * the running game. Leaving it (close, Escape) or saving the same character
 * changes nothing. A different character is remembered for the next visit
 * and handed to the world, which changes the player where it stands.
 * Plain DOM in a corner, like the screens. The button never keeps the
 * keyboard: the game's keys must go to the game.
 */
export function addChangeCharacterButton(parent: HTMLElement, { playing, changeTo, holdGameKeys }: ChangeCharacterOptions): void {
  let current = playing;
  let creatorIsOpen = false;
  const open = async (): Promise<void> => {
    if (creatorIsOpen) return;
    creatorIsOpen = true;
    holdGameKeys(true);
    const chosen = await changeCharacter(parent, { initial: current, previewSheet: playerPreviewSheet() });
    holdGameKeys(false);
    creatorIsOpen = false;
    if (!chosen || sameCharacter(chosen, current)) return;
    current = chosen;
    rememberCharacter(browserCharacterStorage(), chosen);
    changeTo(chosen);
  };
  openCreatorOverGame = () => void open();
  const button = document.createElement('button');
  button.id = 'change-character';
  button.type = 'button';
  button.textContent = 'Change character';
  button.tabIndex = -1;
  button.addEventListener('click', () => void open());
  parent.append(button);
}

/** Where the creator's preview finds the character's sheet. */
function playerPreviewSheet(): PreviewSheet {
  const sprite = getDef(DefId.Player).sprite;
  return { url: spriteSheetUrl(sprite?.key ?? 'player'), frameWidth: sprite?.frameWidth ?? 16, frameHeight: sprite?.frameHeight ?? 24 };
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
