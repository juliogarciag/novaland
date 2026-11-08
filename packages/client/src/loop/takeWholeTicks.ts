/**
 * Pure fixed-timestep maths. Real time goes in, whole sim ticks come out;
 * whatever does not fill a tick is handed back as `leftover` for the next
 * frame. Nothing else in the client may decide when the sim advances.
 */
export interface WholeTicks {
  /** Ticks to run this frame. */
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
 * `deltaSeconds` is clamped to [0, maxFrameSeconds] so a long hitch or a tab
 * switch drops time instead of running hundreds of ticks in one frame.
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
