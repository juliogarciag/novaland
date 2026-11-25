/**
 * The shortest time between two zoom steps the same way, in milliseconds. A
 * notch of a mouse wheel is one event and one step. A trackpad sends dozens
 * of events for one swipe, and how far each says it travelled differs by
 * browser and system (a notch is 4 pixels in one and 100 in another), so
 * steps are counted by time instead of by travel: a swipe steps about five
 * times a second for as long as it lasts.
 */
const WHEEL_STEP_INTERVAL_MS = 200;

/** A zoom step the wheel made. */
export interface WheelStep {
  /** 1 is a step out (wheel down), -1 a step back in (wheel up). */
  readonly stepsOut: 1 | -1;
  /** When the event that made it happened, in milliseconds on any clock that only goes forward. */
  readonly timeMs: number;
}

/**
 * The zoom step a wheel event makes, or undefined when it makes none: it did
 * not move up or down, or it came less than `WHEEL_STEP_INTERVAL_MS` after
 * the last step the same way. Turning the wheel the other way always steps
 * at once. Pass the step this returned last as `lastStep`.
 */
export function wheelStepOf({ deltaY, timeMs, lastStep }: { deltaY: number; timeMs: number; lastStep: WheelStep | undefined }): WheelStep | undefined {
  if (!Number.isFinite(deltaY) || deltaY === 0 || !Number.isFinite(timeMs)) return undefined;
  const stepsOut = deltaY > 0 ? 1 : -1;
  if (lastStep && lastStep.stepsOut === stepsOut && timeMs - lastStep.timeMs < WHEEL_STEP_INTERVAL_MS) return undefined;
  return { stepsOut, timeMs };
}

export const __testing__ = { WHEEL_STEP_INTERVAL_MS };
