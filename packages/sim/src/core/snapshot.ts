import { getAllEntities, getEntityComponents } from 'bitecs';
import type { Sim } from './sim';

/**
 * A snapshot is the complete, JSON-safe state of a sim: every entity with
 * every component field, plus the physics world and the rng. Two sims with
 * equal snapshots will evolve identically given the same commands.
 */
export interface EntitySnapshot {
  readonly id: number;
  readonly components: Record<string, Record<string, number>>;
}

export interface SimSnapshot {
  readonly version: 1;
  readonly seed: number;
  readonly tick: number;
  readonly rng: number;
  readonly entities: EntitySnapshot[];
  /** Rapier world, base64. */
  readonly physics: string;
}

export function takeSnapshot(sim: Sim): SimSnapshot {
  const ids = [...getAllEntities(sim.world)].sort((a, b) => a - b);
  const entities: EntitySnapshot[] = ids.map((id) => {
    const components: Record<string, Record<string, number>> = {};
    for (const store of getEntityComponents(sim.world, id)) {
      const name = sim.componentName(store);
      if (!name) continue;
      const fields: Record<string, number> = {};
      for (const [field, values] of Object.entries(store as Record<string, ArrayLike<number>>)) {
        fields[field] = values[id] as number;
      }
      components[name] = fields;
    }
    return { id, components };
  });
  return {
    version: 1,
    seed: sim.seed,
    tick: sim.tick,
    rng: sim.rng.state(),
    entities,
    physics: toBase64(sim.physics.takeSnapshot()),
  };
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
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(triple >> 18) & 63] as string;
    out += BASE64[(triple >> 12) & 63] as string;
    out += b === undefined ? '=' : (BASE64[(triple >> 6) & 63] as string);
    out += c === undefined ? '=' : (BASE64[triple & 63] as string);
  }
  return out;
}
