/** Global tuning values. Feature-specific numbers belong to that feature's defs. */

/** Simulation ticks per second. The sim never runs at any other rate. */
export const TICK_RATE = 60;

/** Fixed timestep in seconds. */
export const FIXED_DT = 1 / TICK_RATE;

/** Maximum number of live entities per sim. Component stores are sized to this. */
export const DEFAULT_CAPACITY = 1024;
