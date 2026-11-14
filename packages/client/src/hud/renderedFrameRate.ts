/** Length of the window frames are counted over. */
const WINDOW_MS = 1000;

/**
 * Frames the client really drew per second: told of every rendered frame, it
 * counts them over one second of real time after another. Nothing is assumed
 * about the display's refresh rate, and there is no rate to read until the
 * first second has passed.
 */
export class RenderedFrameRate {
  private windowStartedAt: number | undefined;
  private framesInWindow = 0;
  private lastWindowRate: number | undefined;

  /** Frames per second over the last full window; undefined during the first one. */
  get framesPerSecond(): number | undefined {
    return this.lastWindowRate;
  }

  /** A frame was drawn at `nowMs` (any monotonic clock in milliseconds). */
  frameRendered(nowMs: number): void {
    if (this.windowStartedAt === undefined) {
      this.windowStartedAt = nowMs;
      return;
    }
    this.framesInWindow += 1;
    const elapsedMs = nowMs - this.windowStartedAt;
    if (elapsedMs < WINDOW_MS) return;
    // The window ends on a frame, so it is rarely exactly one second: divide by what really passed.
    this.lastWindowRate = (this.framesInWindow * 1000) / elapsedMs;
    this.windowStartedAt = nowMs;
    this.framesInWindow = 0;
  }
}
