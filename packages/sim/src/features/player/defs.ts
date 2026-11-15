import type { EntityDef } from '../../content/defs';
import type { SpriteDef } from '../../content/sprites';

/** Move intents shorter than this count as a stop: too small to move the body or to define a facing. */
export const MIN_MOVE_INTENT = 1e-3;

/**
 * Player feature owns def ids 1-99. Ids are forever: a new def takes the next
 * number, a retired one keeps its number out of use.
 *
 *   1-8  retired in #54: the eight fixed avatars the sim used to hand out. A
 *        player's look is now its own choice (the PlayerLook component).
 *   9    the player character every player wears.
 */
export const PlayerDefId = {
  Player: 9,
} as const;

/** How fast a player walks, in metres per second, and how big its body is, in metres. Players differ in looks only. */
const PLAYER_SPEED = 5;
const PLAYER_RADIUS = 0.4;

/** One colour a player may pick for a part of their character. */
export interface PaletteSwatch {
  readonly name: string;
  /** 0xRRGGBB. */
  readonly color: number;
}

/**
 * The colours a player picks their character from, one small fixed palette
 * per part. A look (character.ts) is an index into each. Indexes are forever,
 * like def ids, because remembered characters hold them: add a swatch at the
 * end, never reorder or remove one.
 */
export const characterPalettes = {
  skin: [
    { name: 'porcelain', color: 0xffdbac },
    { name: 'sand', color: 0xf1c27d },
    { name: 'honey', color: 0xe0ac69 },
    { name: 'bronze', color: 0xc68642 },
    { name: 'umber', color: 0x8d5524 },
    { name: 'ebony', color: 0x5c3a21 },
  ],
  hair: [
    { name: 'black', color: 0x2a2523 },
    { name: 'brown', color: 0x6b3e1e },
    { name: 'copper', color: 0xb45309 },
    { name: 'ginger', color: 0xd97706 },
    { name: 'blond', color: 0xf3e5ab },
    { name: 'grey', color: 0x6b7280 },
    { name: 'pink', color: 0xec4899 },
    { name: 'blue', color: 0x38bdf8 },
  ],
  clothes: [
    { name: 'sky', color: 0x3b82f6 },
    { name: 'rose', color: 0xe11d48 },
    { name: 'moss', color: 0x16a34a },
    { name: 'sun', color: 0xf59e0b },
    { name: 'plum', color: 0x7c3aed },
    { name: 'ember', color: 0xea580c },
    { name: 'teal', color: 0x0d9488 },
    { name: 'slate', color: 0x475569 },
  ],
} as const satisfies Record<string, readonly PaletteSwatch[]>;

/** The parts of a character a player colours, in the order the creator offers them. */
export type CharacterPart = keyof typeof characterPalettes;
export const CHARACTER_PARTS: readonly CharacterPart[] = ['skin', 'hair', 'clothes'];

/** A name is at most this many user-visible characters (grapheme clusters: an accented letter or an emoji counts once). */
export const MAX_NAME_CHARACTERS = 20;
/**
 * And at most this many code points, which is what the PlayerName component
 * stores. Twice the visible limit leaves room for accents and emoji that take
 * several code points while keeping a name a fixed, small number of fields.
 */
export const MAX_NAME_CODE_POINTS = 40;

/**
 * The character is one sheet, `sprites/player.png`: four rows (down, up,
 * left, right) of four 16x24 frames, frame 0 of a row being the idle pose and
 * the whole row the walk cycle. It is painted in fixed template colours by
 * packages/client/tools/generate-player-sheet.mjs and the client swaps them
 * for the colours of each player's look. `color` is for views that draw a
 * flat shape instead of the sheet.
 */
function playerSprite(key: string): SpriteDef {
  return {
    key,
    frameWidth: 16,
    frameHeight: 24,
    pixelsPerMetre: 16,
    origin: { x: 0.5, y: 0.75 },
    frameRate: 8,
    directions: {
      down: { idle: 0, walk: { start: 0, end: 3 } },
      up: { idle: 4, walk: { start: 4, end: 7 } },
      left: { idle: 8, walk: { start: 8, end: 11 } },
      right: { idle: 12, walk: { start: 12, end: 15 } },
    },
  };
}

export const playerDefs: readonly EntityDef[] = [
  {
    id: PlayerDefId.Player,
    name: 'player',
    shape: 'circle',
    radius: PLAYER_RADIUS,
    speed: PLAYER_SPEED,
    color: 0x3b82f6,
    sprite: playerSprite('player'),
  },
];

/** True when `defId` is the player character, so an entity wearing it is a player. */
export function isPlayerDefId(defId: number): boolean {
  return defId === PlayerDefId.Player;
}
