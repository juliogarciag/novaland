import { hasComponent, query } from 'bitecs';
import { asEntityWorld } from '../../core/entityWorld';
import type { SimHandle } from '../../core/sim';
import { Position } from '../../core/transform';
import { holdsOnlyNameCharacters, isPaletteIndex, showsSomething, type Character } from './character';
import { Facing, MoveIntent, nameCodePointField, PlayerLook, PlayerName, Player } from './components';
import { MAX_NAME_CODE_POINTS } from './defs';

/** Entity id of the player in `slot`, or undefined if nobody is in it. */
export function findPlayerEntity(handle: SimHandle, slot: number): number | undefined {
  const sim = asEntityWorld(handle);
  const player = sim.store(Player);
  for (const eid of query(sim.world, [player])) {
    if (player.slot[eid] === slot) return eid;
  }
  return undefined;
}

/** Where the player in `slot` stands, in metres; undefined if nobody is in it. What a server saves so the player can return there. */
export function getPlayerPosition(handle: SimHandle, slot: number): { x: number; y: number } | undefined {
  const eid = findPlayerEntity(handle, slot);
  if (eid === undefined) return undefined;
  const position = asEntityWorld(handle).store(Position);
  return { x: position.x[eid] as number, y: position.y[eid] as number };
}

/** Which way an entity is going and looking. Both are vectors in sim space (y points down). */
export interface Heading {
  /** Current move intent, zero when the player is standing still. */
  readonly moveIntent: { readonly x: number; readonly y: number };
  /** Unit direction of the last non-zero move intent. */
  readonly facing: { readonly x: number; readonly y: number };
}

/**
 * Heading of entity `eid`, or undefined if it is not something that moves and
 * faces (today only players). Views pick a walk or idle frame from it.
 */
export function getHeading(handle: SimHandle, eid: number): Heading | undefined {
  const sim = asEntityWorld(handle);
  const intent = sim.store(MoveIntent);
  const facing = sim.store(Facing);
  if (!Number.isInteger(eid) || eid < 1 || eid > sim.capacity) return undefined;
  if (!hasComponent(sim.world, eid, intent) || !hasComponent(sim.world, eid, facing)) return undefined;
  return {
    moveIntent: { x: intent.x[eid] as number, y: intent.y[eid] as number },
    facing: { x: facing.x[eid] as number, y: facing.y[eid] as number },
  };
}

/** What a view shows for a name it cannot read (a replica fed something no sim would write). */
const UNREADABLE_NAME = '?';

/**
 * The character of entity `eid`: the name to draw above it and the swatches
 * it wears, or undefined if it has none (today only players do). What comes
 * back is always legal, on a replica too: a replica is fed from the network,
 * so a name that is not one reads as "?" and a palette index out of range as
 * the first swatch, instead of reaching the view.
 */
export function getCharacter(handle: SimHandle, eid: number): Character | undefined {
  const sim = asEntityWorld(handle);
  const look = sim.store(PlayerLook);
  const playerName = sim.store(PlayerName);
  if (!Number.isInteger(eid) || eid < 1 || eid > sim.capacity) return undefined;
  if (!hasComponent(sim.world, eid, look) || !hasComponent(sim.world, eid, playerName)) return undefined;
  const skin = look.skin[eid];
  const hair = look.hair[eid];
  const clothes = look.clothes[eid];
  return {
    name: readStoredName(playerName, eid),
    look: {
      skin: isPaletteIndex('skin', skin) ? skin : 0,
      hair: isPaletteIndex('hair', hair) ? hair : 0,
      clothes: isPaletteIndex('clothes', clothes) ? clothes : 0,
    },
  };
}

function readStoredName(playerName: Record<string, Uint32Array>, eid: number): string {
  const length = Math.min((playerName['length'] as Uint32Array)[eid] as number, MAX_NAME_CODE_POINTS);
  const codePoints: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const codePoint = (playerName[nameCodePointField(index)] as Uint32Array)[eid] as number;
    if (codePoint > 0x10ffff) return UNREADABLE_NAME;
    codePoints.push(codePoint);
  }
  const name = String.fromCodePoint(...codePoints);
  // Only what protects the view is asked here, not the whole rule: the sim that stored the name judged its length with
  // its own Unicode tables, and this engine's may count a newer emoji differently.
  return holdsOnlyNameCharacters(name) && showsSomething(name) && name === name.trim() ? name : UNREADABLE_NAME;
}
