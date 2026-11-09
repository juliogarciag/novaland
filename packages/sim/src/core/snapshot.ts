import { getAllEntities, getEntityComponents } from 'bitecs';
import type { EntityWorld } from './entityWorld';
import type { Sim } from './sim';

/**
 * A snapshot is the complete, JSON-safe state of a sim: every entity with
 * every component field, plus the physics world and the rng. Two sims with
 * equal snapshots will evolve identically given the same commands.
 *
 * Entities, components and fields are sorted so that the hash does not depend
 * on the order things were attached in.
 */
export interface EntitySnapshot {
  readonly id: number;
  readonly components: Record<string, Record<string, number>>;
}

export interface SimSnapshot {
  readonly version: 1;
  readonly seed: number;
  /** Name of the level the sim was built from. */
  readonly level: string;
  readonly capacity: number;
  readonly tick: number;
  readonly rng: number;
  readonly entities: EntitySnapshot[];
  /** Rapier world, base64. */
  readonly physics: string;
}

export function takeSnapshot(sim: Sim): SimSnapshot {
  return {
    version: 1,
    seed: sim.seed,
    level: sim.level.name,
    capacity: sim.capacity,
    tick: sim.tick,
    rng: sim.rng.state(),
    entities: snapshotEntities(sim),
    physics: toBase64(sim.physics.takeSnapshot()),
  };
}

/**
 * Every entity with every component field, sorted by id, component name and
 * field name. This is the `entities` part of a snapshot and the whole of a
 * world state (see worldState.ts); a replica produces it too.
 */
export function snapshotEntities(entityWorld: EntityWorld): EntitySnapshot[] {
  const ids = [...getAllEntities(entityWorld.world)].sort((a, b) => a - b);
  return ids.map((id) => {
    const named: Array<[string, Record<string, ArrayLike<number>>]> = [];
    for (const store of getEntityComponents(entityWorld.world, id)) {
      const name = entityWorld.componentName(store);
      if (name) named.push([name, store as Record<string, ArrayLike<number>>]);
    }
    named.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const components: Record<string, Record<string, number>> = {};
    for (const [name, store] of named) {
      const fields: Record<string, number> = {};
      for (const field of Object.keys(store).sort()) {
        fields[field] = store[field]![id] as number;
      }
      components[name] = fields;
    }
    return { id, components };
  });
}

/** Stable 32-bit FNV-1a hash of a snapshot, as 8 hex chars. Handy for desync checks and tests. */
export function hashSnapshot(snapshot: SimSnapshot): string {
  const text = JSON.stringify(snapshot);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure base64 encoder: the sim cannot rely on btoa (DOM) or Buffer (Node). */
export function toBase64(bytes: Uint8Array): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i] as number;
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64[(triple >> 18) & 63] as string;
    encoded += BASE64[(triple >> 12) & 63] as string;
    encoded += second === undefined ? '=' : (BASE64[(triple >> 6) & 63] as string);
    encoded += third === undefined ? '=' : (BASE64[triple & 63] as string);
  }
  return encoded;
}
