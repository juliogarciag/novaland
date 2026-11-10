import { createSim, type Renderable } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { interpolateViewFrames, readViewFrame, type ViewFrame } from './viewFrame';

describe('readViewFrame', () => {
  it('reads what a sim draws at its tick, with a heading for the player (terrain is a tilemap, not a renderable)', async () => {
    const sim = await createSim({ seed: 1 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    const frame = readViewFrame(sim);
    expect(frame.tick).toBe(2);
    expect(frame.renderables).toHaveLength(1);
    expect(frame.headings.get(frame.renderables[0]!.eid)?.moveIntent).toEqual({ x: 1, y: 0 });
  });
});

describe('interpolateViewFrames', () => {
  it('moves an entity part of the way between two frames and gives the frame a fractional tick', () => {
    const from = frame(10, [renderable(1, 0, 0)]);
    const to = frame(13, [renderable(1, 3, -6)]);
    const halfway = interpolateViewFrames(from, to, 0.5);
    expect(halfway.tick).toBe(11.5);
    expect(halfway.renderables).toEqual([renderable(1, 1.5, -3)]);
  });

  it('clamps alpha to [0, 1]', () => {
    const from = frame(10, [renderable(1, 0, 0)]);
    const to = frame(13, [renderable(1, 3, 0)]);
    expect(interpolateViewFrames(from, to, -1).renderables[0]!.x).toBe(0);
    expect(interpolateViewFrames(from, to, 2)).toBe(to);
  });

  it('draws what the newer frame has: an entity that appeared sits where it is, one that vanished is gone', () => {
    const from = frame(10, [renderable(1, 0, 0), renderable(2, 5, 5)]);
    const to = frame(13, [renderable(1, 3, 0), renderable(3, 9, 9)]);
    const between = interpolateViewFrames(from, to, 0.25);
    expect(between.renderables.map((item) => item.eid)).toEqual([1, 3]);
    expect(between.renderables[1]).toEqual(renderable(3, 9, 9));
  });

  it('snaps an entity whose id now means something else (another def or size) instead of sliding it across the map', () => {
    const from = frame(10, [renderable(1, 0, 0)]);
    const to = frame(13, [{ ...renderable(1, 20, 20), defId: 7 }]);
    expect(interpolateViewFrames(from, to, 0.5).renderables[0]).toEqual({ ...renderable(1, 20, 20), defId: 7 });
  });

  it("takes the newer frame's headings", () => {
    const heading = { moveIntent: { x: 0, y: 1 }, facing: { x: 0, y: 1 } };
    const from = frame(10, [renderable(1, 0, 0)]);
    const to = { ...frame(13, [renderable(1, 0, 3)]), headings: new Map([[1, heading]]) };
    expect(interpolateViewFrames(from, to, 0.5).headings.get(1)).toBe(heading);
  });
});

// ---- Helpers ----

function renderable(eid: number, x: number, y: number): Renderable {
  return { eid, defId: 1, x, y, halfWidth: 0.4, halfHeight: 0.4 };
}

function frame(tick: number, renderables: Renderable[]): ViewFrame {
  return { tick, renderables, headings: new Map() };
}
