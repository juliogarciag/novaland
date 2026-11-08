/**
 * Components are structure-of-arrays stores of numbers, one typed array per
 * field, indexed by entity id. That is all a component may hold: no strings,
 * no objects, no references. Rich data lives in defs (see content/defs.ts).
 */
export type NumericArray = Float64Array | Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;
export type NumericStore = Record<string, NumericArray>;

/**
 * A component definition is a named factory. Each Sim creates its own store
 * from it (see Sim.store), so two sims in the same process never share data.
 * Names must be unique across all features: they key the snapshot.
 */
export interface ComponentDef<T extends NumericStore = NumericStore> {
  readonly name: string;
  readonly create: (capacity: number) => T;
}

const registry = new Map<string, ComponentDef>();

export function defineComponent<T extends NumericStore>(name: string, create: (capacity: number) => T): ComponentDef<T> {
  if (registry.has(name)) {
    throw new Error(`Component "${name}" is already defined. Component names must be unique across features.`);
  }
  const def: ComponentDef<T> = { name, create };
  registry.set(name, def);
  return def;
}

/** Looks a definition up by its snapshot name (for restoring snapshots). */
export function getComponentDef(name: string): ComponentDef | undefined {
  return registry.get(name);
}

export const f64 = (capacity: number): Float64Array => new Float64Array(capacity);
export const u32 = (capacity: number): Uint32Array => new Uint32Array(capacity);
