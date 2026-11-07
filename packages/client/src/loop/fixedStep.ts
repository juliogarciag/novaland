/**
 * Pure fixed-timestep accumulator. Real time goes in, whole sim ticks come
 * out; whatever is left waits for the next frame. Nothing else in the client
 * may decide when the sim advances.
 */
export interface FixedStepResult {
  /** Ticks to run this frame. */
  readonly ticks: number;
  /** Leftover time to carry into the next frame, always in [0, dt). */
  readonly accumulator: number;
}

export function advanceFixedStep(accumulator: number, deltaSeconds: number, dt: number, maxFrameSeconds: number): FixedStepResult {
  const delta = Math.min(Math.max(deltaSeconds, 0), maxFrameSeconds);
  let remaining = accumulator + delta;
  let ticks = 0;
  while (remaining >= dt) {
    remaining -= dt;
    ticks += 1;
  }
  return { ticks, accumulator: remaining };
}
