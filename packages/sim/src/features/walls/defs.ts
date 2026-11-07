import type { EntityDef } from '../../content/defs';

/** Walls feature owns def ids 100-199. */
export const WallDefId = {
  Wall: 100,
} as const;

export const wallDefs: readonly EntityDef[] = [
  { id: WallDefId.Wall, name: 'wall', shape: 'box', color: 0x475569 },
];
