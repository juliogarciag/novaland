/**
 * Entity definitions: the static, rich data behind every entity kind.
 *
 * Entities reference a definition through the numeric `DefRef.id` component.
 * Components only hold numbers; everything else (names, colours, speeds,
 * shapes) lives here. Adding a new kind of thing that behaves like an existing
 * one is a new entry in that feature's `defs.ts` and nothing else.
 *
 * Each feature owns its defs in `features/<feature>/defs.ts` and a block of
 * ids, so parallel work never collides on this file:
 *
 *   player   1-99
 *   walls    100-199  (retired in #9: walls became terrain tiles; the ids stay reserved)
 *   terrain  200-299
 *   (next feature: claim the next block of 100 here)
 *
 * Ids are stable forever: they end up in save files. Never reuse or renumber.
 * See docs/decisions/0001-ecs.md.
 */
import { PlayerDefId, playerDefs } from '../features/player/defs';
import { TerrainDefId, terrainDefs } from '../features/terrain/defs';

export type DefShape = 'circle' | 'box';

export interface EntityDef {
  /** Stable numeric id from the feature's block. */
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

export const DefId = { ...PlayerDefId, ...TerrainDefId } as const;

export const entityDefs: readonly EntityDef[] = [...playerDefs, ...terrainDefs];

const byId: ReadonlyMap<number, EntityDef> = new Map(entityDefs.map((def) => [def.id, def]));

if (byId.size !== entityDefs.length) {
  throw new Error('entityDefs contains duplicate ids');
}

export function getDef(id: number): EntityDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown entity def id ${id}`);
  return def;
}
