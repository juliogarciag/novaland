/**
 * Pure fixed-timestep maths, the same as the client's
 * `client/src/loop/takeWholeTicks.ts`: real time goes in, whole sim ticks come
 * out; whatever does not fill a tick is handed back as `leftover` for the next
 * wake-up. The room is the only thing in the server that steps the sim, and it
 * only does so through this.
 */
export interface WholeTicks {
  /** Ticks to run now. */
  readonly ticks: number;
  /** Time that did not fill a whole tick, always in [0, dt). Carry it into the next call. */
  readonly leftover: number;
}

export interface TakeWholeTicksInput {
  /** Time left over from the previous call. */
  readonly leftover: number;
  /** Real time since the previous call. */
  readonly deltaSeconds: number;
  /** Length of one sim tick. */
  readonly dt: number;
  /** Most real time one call may absorb; anything beyond is dropped. */
  readonly maxFrameSeconds: number;
}

/**
 * Takes as many whole ticks of `dt` as fit in `leftover + deltaSeconds`.
 * `deltaSeconds` is clamped to [0, maxFrameSeconds] so a stalled process
 * drops time instead of running hundreds of ticks in one wake-up.
 */
export function takeWholeTicks({ leftover, deltaSeconds, dt, maxFrameSeconds }: TakeWholeTicksInput): WholeTicks {
  const delta = Math.min(Math.max(deltaSeconds, 0), maxFrameSeconds);
  let remaining = leftover + delta;
  let ticks = 0;
  while (remaining >= dt) {
    remaining -= dt;
    ticks += 1;
  }
  return { ticks, leftover: remaining };
}
