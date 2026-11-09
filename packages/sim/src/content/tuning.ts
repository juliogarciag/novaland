/** Global tuning values. Feature-specific numbers belong to that feature's defs. */

/** Simulation ticks per second. The sim never runs at any other rate. */
export const TICK_RATE = 60;

/** Fixed timestep in seconds. */
export const FIXED_DT = 1 / TICK_RATE;

/** Maximum number of live entities per sim. Component stores are sized to this. */
export const DEFAULT_CAPACITY = 1024;

/** Radius in metres for circle defs that do not specify one. */
export const DEFAULT_RADIUS = 0.5;

/** Seats a world can hold. Slots outside [0, MAX_PLAYER_SLOTS) are rejected. */
export const MAX_PLAYER_SLOTS = 64;

/** World-state deltas per second a server sends its players. The server may be configured with another rate. */
export const DEFAULT_SEND_RATE = 20;
