import { interpolateViewFrames, type ViewFrame } from '../render/viewFrame';

export interface ViewFrameBufferOptions {
  /** How far behind the newest frame the drawn frame stays, in ticks. */
  readonly bufferTicks: number;
  /** Ticks the drawn tick advances per second of real time (the sim's tick rate). */
  readonly ticksPerSecond: number;
}

/** Most frames kept; older ones are dropped. At the default rates this is a few seconds. */
const MAX_FRAMES = 64;
/** Share of the drift between the drawn tick and where it should be that each frame closes; more than `bufferTicks` behind, it jumps instead. */
const CATCH_UP_SHARE = 0.1;

/**
 * Server frames arrive at the send rate; the screen draws at the display
 * rate. The buffer keeps the last few frames and a drawn tick that advances
 * with real time but stays `bufferTicks` behind the newest frame, so there is
 * almost always a frame on each side of it to interpolate between. Small
 * drift (clock skew, jitter) is closed gradually; a large one (a stall, a
 * burst, a server that jumped ahead) snaps. Pure arithmetic, no timers: the
 * caller passes real time in.
 */
export class ViewFrameBuffer {
  private frames: ViewFrame[] = [];
  private drawnTick: number | undefined;

  constructor(private readonly options: ViewFrameBufferOptions) {}

  /** A newer frame to draw towards. A frame that does not come after the newest one starts the buffer over (the server restarted, or sent a full state). */
  push(frame: ViewFrame): void {
    const newest = this.frames.at(-1);
    if (newest && frame.tick <= newest.tick) this.reset();
    this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
  }

  /** Forgets every frame; the next push starts fresh. */
  reset(): void {
    this.frames = [];
    this.drawnTick = undefined;
  }

  /** The drawn tick, for tests and debugging; undefined before the first frame was asked for. */
  get tick(): number | undefined {
    return this.drawnTick;
  }

  /** The frame to draw after `deltaSeconds` more real time, or undefined before any frame was pushed. */
  nextFrame(deltaSeconds: number): ViewFrame | undefined {
    const newest = this.frames.at(-1);
    const oldest = this.frames[0];
    if (!newest || !oldest) return undefined;
    const target = newest.tick - this.options.bufferTicks;
    if (this.drawnTick === undefined) {
      this.drawnTick = target;
    } else {
      const advanceTicks = Math.max(0, deltaSeconds) * this.options.ticksPerSecond;
      const drift = target - (this.drawnTick + advanceTicks);
      let correction: number;
      if (drift > this.options.bufferTicks) correction = drift; // far behind (a stall, a burst): jump
      else if (drift >= 0) correction = drift * CATCH_UP_SHARE; // a little behind: hurry
      else correction = Math.max(drift * CATCH_UP_SHARE, -advanceTicks); // ahead (frames are late): slow down, never go back
      this.drawnTick += advanceTicks + correction;
    }
    // Never past what the server has shown, never before what is still kept.
    this.drawnTick = Math.min(newest.tick, Math.max(oldest.tick, this.drawnTick));
    let fromIndex = 0;
    while (fromIndex + 1 < this.frames.length && (this.frames[fromIndex + 1] as ViewFrame).tick <= this.drawnTick) fromIndex += 1;
    if (fromIndex > 0) this.frames.splice(0, fromIndex);
    const from = this.frames[0] as ViewFrame;
    const to = this.frames[1];
    if (!to) return from;
    return interpolateViewFrames(from, to, (this.drawnTick - from.tick) / (to.tick - from.tick));
  }
}
