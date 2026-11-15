import { defineComponent, f64, u32 } from '../../core/components';
import { MAX_NAME_CODE_POINTS } from './defs';

/** Marks a player-controlled entity and which seat controls it. */
export const Player = defineComponent('Player', (capacity) => ({
  slot: u32(capacity),
}));

/** Last requested movement direction, unit length or shorter. */
export const MoveIntent = defineComponent('MoveIntent', (capacity) => ({
  x: f64(capacity),
  y: f64(capacity),
}));

/**
 * Unit direction of the last non-zero move intent: the way a stopped player
 * looks. Starts facing down (towards the screen) on spawn.
 */
export const Facing = defineComponent('Facing', (capacity) => ({
  x: f64(capacity),
  y: f64(capacity),
}));

/** The swatch of each palette the player wears: indexes into `characterPalettes` (defs.ts). */
export const PlayerLook = defineComponent('PlayerLook', (capacity) => ({
  skin: u32(capacity),
  hair: u32(capacity),
  clothes: u32(capacity),
}));

/** Field of PlayerName holding the code point at `index` of the name. */
export function nameCodePointField(index: number): string {
  return `codePoint${String(index).padStart(2, '0')}`;
}

/**
 * The player's name as numbers: how many code points it has, then one field
 * per code point, zero past the end. Components hold numbers only, and this
 * keeps a free-text name inside them, so it is in every snapshot and travels
 * in world states like any other field (ADR 0010). Written once, on join, by
 * `writePlayerName`; read back as a string by `getCharacter` (queries.ts).
 */
export const PlayerName = defineComponent('PlayerName', (capacity) => {
  const fields: Record<string, Uint32Array> = { length: u32(capacity) };
  for (let index = 0; index < MAX_NAME_CODE_POINTS; index += 1) fields[nameCodePointField(index)] = u32(capacity);
  return fields;
});
