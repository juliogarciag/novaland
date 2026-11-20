import type { SpriteDirection } from '@novaland/sim';

/** The keys that walk in the game, by the physical key (`KeyboardEvent.code`), and the way each one turns the creator's preview. */
const FACING_BY_KEY: Readonly<Record<string, SpriteDirection>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** What the creator needs to know of a key press. */
export interface FacingKeyPress {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** Where the press happened: a press while typing in a text field is text, never a turn. */
  readonly target: EventTarget | null;
}

/**
 * The way a key press turns the creator's preview, or undefined when it does
 * not: the same keys the game walks with (W, A, S, D and the arrows), pressed
 * without a modifier (so the browser's shortcuts keep working) and outside a
 * field the player types in.
 */
export function facingOfKeyPress(press: FacingKeyPress): SpriteDirection | undefined {
  if (press.altKey || press.ctrlKey || press.metaKey || isTypingField(press.target)) return undefined;
  return FACING_BY_KEY[press.code];
}

/** True when `target` takes typed text: a text-like input, a text area or an editable element. */
function isTypingField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/** Inputs that take no typed text, so the walking keys still turn the preview while one has focus. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
