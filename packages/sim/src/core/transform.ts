import { defineComponent, f64, u32 } from './components';

/** World position in metres. Written by the physics sync each tick for entities with a Body. */
export const Position = defineComponent('Position', (capacity) => ({
  x: f64(capacity),
  y: f64(capacity),
}));

/** Half extents in metres, for anything box-shaped or that needs a size per entity. */
export const Extents = defineComponent('Extents', (capacity) => ({
  halfWidth: f64(capacity),
  halfHeight: f64(capacity),
}));

/** Reference to an entity definition (content/defs.ts). */
export const DefRef = defineComponent('DefRef', (capacity) => ({
  id: u32(capacity),
}));
