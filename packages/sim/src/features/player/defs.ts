import type { EntityDef } from '../../content/defs';

/** Player feature owns def ids 1-99. */
export const PlayerDefId = {
  Player: 1,
} as const;

export const playerDefs: readonly EntityDef[] = [
  { id: PlayerDefId.Player, name: 'player', shape: 'circle', radius: 0.4, speed: 5, color: 0x4ade80 },
];
