/**
 * Entity definitions: the static, rich data behind every entity kind.
 *
 * Entities reference a definition through the numeric `DefRef.id` component.
 * Components only hold numbers; everything else (names, colours, speeds,
 * shapes) lives here. Adding a new kind of thing that behaves like an existing
 * one is a new entry in `entityDefs` and nothing else.
 *
 * See docs/decisions/0001-ecs.md.
 */

export type DefShape = 'circle' | 'box';

export interface EntityDef {
  /** Stable numeric id. Never reuse or renumber: ids end up in save files. */
  readonly id: number;
  readonly name: string;
  readonly shape: DefShape;
  /** 0xRRGGBB, used by views. */
  readonly color: number;
  /** Radius in metres for circle shapes. Boxes carry their size per entity (Extents). */
  readonly radius?: number;
  /** Movement speed in metres per second, for things that move on their own. */
  readonly speed?: number;
}

export const DefId = {
  Player: 1,
  Wall: 2,
} as const;

export const entityDefs: readonly EntityDef[] = [
  { id: DefId.Player, name: 'player', shape: 'circle', radius: 0.4, speed: 5, color: 0x4ade80 },
  { id: DefId.Wall, name: 'wall', shape: 'box', color: 0x475569 },
];

const byId: ReadonlyMap<number, EntityDef> = new Map(entityDefs.map((def) => [def.id, def]));

if (byId.size !== entityDefs.length) {
  throw new Error('entityDefs contains duplicate ids');
}

export function getDef(id: number): EntityDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown entity def id ${id}`);
  return def;
}
