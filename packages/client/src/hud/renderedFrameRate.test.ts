import { describe, expect, it } from 'vitest';
import { RenderedFrameRate } from './renderedFrameRate';

describe('RenderedFrameRate', () => {
  it('has no rate until a first second of frames has been counted', () => {
    const frameRate = new RenderedFrameRate();
    expect(frameRate.framesPerSecond).toBeUndefined();
    renderFrames(frameRate, { from: 0, everyMs: 10, count: 100 });
    expect(frameRate.framesPerSecond).toBeUndefined();
    frameRate.frameRendered(1000);
    expect(frameRate.framesPerSecond).toBe(100);
  });

  it('counts the frames that were drawn, whatever the display rate', () => {
    for (const everyMs of [1000 / 30, 1000 / 60, 1000 / 144]) {
      const frameRate = new RenderedFrameRate();
      renderFrames(frameRate, { from: 5000, everyMs, count: Math.ceil(2500 / everyMs) });
      expect(frameRate.framesPerSecond).toBeCloseTo(1000 / everyMs, 6);
    }
  });

  it('follows a rate that changes, one second later', () => {
    const frameRate = new RenderedFrameRate();
    renderFrames(frameRate, { from: 0, everyMs: 20, count: 51 });
    expect(frameRate.framesPerSecond).toBe(50);
    renderFrames(frameRate, { from: 1100, everyMs: 100, count: 10 });
    expect(frameRate.framesPerSecond).toBe(10);
  });

  it('reports the gap honestly when nothing was drawn for a long while, then recovers', () => {
    const frameRate = new RenderedFrameRate();
    renderFrames(frameRate, { from: 0, everyMs: 10, count: 101 });
    // A hidden tab: the next frame comes ten seconds later.
    frameRate.frameRendered(11000);
    expect(frameRate.framesPerSecond).toBeCloseTo(0.1, 6);
    renderFrames(frameRate, { from: 11010, everyMs: 10, count: 100 });
    expect(frameRate.framesPerSecond).toBe(100);
  });
});

// ---- Helpers ----

/** Renders `count` frames, the first at `from` and one every `everyMs` after it. */
function renderFrames(frameRate: RenderedFrameRate, { from, everyMs, count }: { from: number; everyMs: number; count: number }): void {
  for (let frame = 0; frame < count; frame += 1) frameRate.frameRendered(from + frame * everyMs);
}
