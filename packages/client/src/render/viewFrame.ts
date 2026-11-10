import { getHeading, getRenderables, type Heading, type Renderable, type SimHandle } from '@novaland/sim';

/**
 * Everything the entity renderer needs for one drawn frame, read from a sim
 * or a replica at one tick: what to draw and which way each thing is going.
 * Solo, a frame is read from the sim after every step. Online, frames are
 * read from the replica after every server update and the renderer draws a
 * point between two of them (`interpolateViewFrames` below, driven by
 * online/frameBuffer.ts), so the renderer never knows which mode it is in.
 */
export interface ViewFrame {
  /** The tick the frame shows; fractional between two server frames. */
  readonly tick: number;
  readonly renderables: readonly Renderable[];
  /** Heading by entity id, for the entities that have one. */
  readonly headings: ReadonlyMap<number, Heading>;
}

/** What `handle` would draw right now. */
export function readViewFrame(handle: SimHandle): ViewFrame {
  const renderables = getRenderables(handle);
  const headings = new Map<number, Heading>();
  for (const renderable of renderables) {
    const heading = getHeading(handle, renderable.eid);
    if (heading) headings.set(renderable.eid, heading);
  }
  return { tick: handle.tick, renderables, headings };
}

/**
 * The frame `alpha` of the way from `from` to `to` (0 draws `from`'s
 * positions, 1 draws `to`'s; values outside are clamped). The set of things
 * drawn is `to`'s: something that appeared between the two frames shows up
 * where `to` has it, something that vanished is gone. A position is
 * interpolated only while the entity id means the same thing in both frames
 * (same def and size; ids are recycled), otherwise it snaps to `to`.
 * Headings are `to`'s, so a walk starts and stops with the newer frame.
 */
export function interpolateViewFrames(from: ViewFrame, to: ViewFrame, alpha: number): ViewFrame {
  const weight = Math.min(1, Math.max(0, alpha));
  if (weight >= 1) return to;
  const fromById = new Map(from.renderables.map((renderable) => [renderable.eid, renderable]));
  const renderables = to.renderables.map((renderable) => {
    const before = fromById.get(renderable.eid);
    if (!before || before.defId !== renderable.defId || before.halfWidth !== renderable.halfWidth || before.halfHeight !== renderable.halfHeight) {
      return renderable;
    }
    return {
      ...renderable,
      x: before.x + (renderable.x - before.x) * weight,
      y: before.y + (renderable.y - before.y) * weight,
    };
  });
  return { tick: from.tick + (to.tick - from.tick) * weight, renderables, headings: to.headings };
}
