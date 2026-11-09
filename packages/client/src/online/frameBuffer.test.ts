import type { Renderable } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import type { ViewFrame } from '../render/viewFrame';
import { ViewFrameBuffer } from './frameBuffer';

const TICKS_PER_SECOND = 60;
const SEND_EVERY = 3;
const BUFFER_TICKS = 2 * SEND_EVERY;
const FRAME_SECONDS = 1 / 60;

describe('ViewFrameBuffer', () => {
  it('has nothing to draw before a frame arrives, then draws the first frame', () => {
    const buffer = newBuffer();
    expect(buffer.advance(FRAME_SECONDS)).toBeUndefined();
    buffer.push(frameAt(30, 0));
    expect(buffer.advance(FRAME_SECONDS)).toEqual(frameAt(30, 0));
  });

  it('draws two send intervals behind the newest frame, moving the entity between frames at the display rate', () => {
    const buffer = newBuffer();
    // A player walking right at one metre per second; the server sends a frame every 3 ticks, the screen draws every tick.
    const drawn: ViewFrame[] = [];
    for (let tick = 0; tick <= 180; tick += 1) {
      if (tick % SEND_EVERY === 0) buffer.push(frameAt(tick, tick / TICKS_PER_SECOND));
      const frame = buffer.advance(FRAME_SECONDS) as ViewFrame;
      if (tick > 120) drawn.push(frame);
    }
    for (const frame of drawn) expect(frame.tick).toBeLessThanOrEqual(buffer.tick as number);
    // Every drawn frame is a new position: 60 Hz motion from 20 Hz frames...
    const positions = drawn.map((frame) => frame.renderables[0]!.x);
    expect(new Set(positions).size).toBe(positions.length);
    for (let index = 1; index < positions.length; index += 1) expect(positions[index]).toBeGreaterThan(positions[index - 1]!);
    // ...at the speed the server showed, one metre per second, about two send intervals behind it.
    expect(positions.at(-1)! - positions[0]!).toBeCloseTo((positions.length - 1) / 60, 1);
    expect(180 - (drawn.at(-1) as ViewFrame).tick).toBeGreaterThan(BUFFER_TICKS - 2);
    expect(180 - (drawn.at(-1) as ViewFrame).tick).toBeLessThan(BUFFER_TICKS + 2);
  });

  it('keeps the lag when frames arrive as the clock runs', () => {
    const buffer = newBuffer();
    buffer.push(frameAt(0, 0));
    buffer.advance(FRAME_SECONDS);
    for (let tick = SEND_EVERY; tick <= 300; tick += SEND_EVERY) {
      buffer.push(frameAt(tick, 0));
      for (let frame = 0; frame < SEND_EVERY; frame += 1) buffer.advance(FRAME_SECONDS);
      if (tick > 30) {
        expect(tick - (buffer.tick as number)).toBeGreaterThan(BUFFER_TICKS - 2);
        expect(tick - (buffer.tick as number)).toBeLessThan(BUFFER_TICKS + 2);
      }
    }
  });

  it('never draws past the newest frame when frames stop, and jumps back behind them when they resume far ahead', () => {
    const buffer = newBuffer();
    for (let tick = 0; tick <= 12; tick += SEND_EVERY) buffer.push(frameAt(tick, tick));
    for (let frame = 0; frame < 60; frame += 1) buffer.advance(FRAME_SECONDS);
    expect(buffer.tick).toBe(12);
    expect(buffer.advance(FRAME_SECONDS)).toEqual(frameAt(12, 12));
    buffer.push(frameAt(120, 120));
    buffer.advance(FRAME_SECONDS);
    expect(buffer.tick).toBe(120 - BUFFER_TICKS);
  });

  it('closes a small drift gradually instead of jumping', () => {
    const buffer = newBuffer();
    buffer.push(frameAt(0, 0));
    buffer.push(frameAt(30, 0));
    buffer.advance(FRAME_SECONDS); // drawn tick settles at 24
    buffer.push(frameAt(32, 0)); // the server is a little early: target 26 while the clock says 25
    buffer.advance(FRAME_SECONDS);
    expect(buffer.tick).toBeGreaterThan(25);
    expect(buffer.tick).toBeLessThan(26);
  });

  it('starts over when a frame does not come after the newest one (a full state after a server restart)', () => {
    const buffer = newBuffer();
    buffer.push(frameAt(300, 0));
    buffer.push(frameAt(303, 0));
    buffer.advance(FRAME_SECONDS);
    buffer.push(frameAt(5, 9));
    expect(buffer.advance(FRAME_SECONDS)).toEqual(frameAt(5, 9));
    expect(buffer.tick).toBe(5);
  });

  it('forgets frames it has drawn past and keeps at most a few seconds of them', () => {
    const buffer = newBuffer();
    for (let tick = 0; tick < 3000; tick += SEND_EVERY) buffer.push(frameAt(tick, 0));
    const drawn = buffer.advance(FRAME_SECONDS) as ViewFrame;
    expect(drawn.tick).toBeGreaterThan(3000 - 64 * SEND_EVERY);
  });
});

// ---- Helpers ----

function newBuffer(): ViewFrameBuffer {
  return new ViewFrameBuffer({ bufferTicks: BUFFER_TICKS, ticksPerSecond: TICKS_PER_SECOND });
}

function frameAt(tick: number, x: number): ViewFrame {
  const renderable: Renderable = { eid: 1, defId: 1, x, y: 0, halfWidth: 0.4, halfHeight: 0.4 };
  return { tick, renderables: [renderable], headings: new Map() };
}
