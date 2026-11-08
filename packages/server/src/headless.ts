import { createSim, findPlayerEntity, getRenderables, hashSnapshot, type Command } from '@novaland/sim';

export interface HeadlessRunOptions {
  /** Number of ticks to simulate (the join happens on the first one). */
  readonly ticks: number;
  readonly seed?: number;
}

export interface HeadlessRunResult {
  readonly ticks: number;
  readonly hash: string;
  readonly player: { readonly x: number; readonly y: number } | null;
}

/** Ticks at which the scripted player changes course. */
const SCRIPT = { right: 1, down: 120, stop: 180 } as const;

/**
 * Drives a sim with a scripted player for `ticks` ticks. This is the shape of
 * what a server room will do, minus the network.
 */
export async function runHeadless({ ticks, seed = 0 }: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const sim = await createSim({ seed });
  try {
    for (let tick = 0; tick < ticks; tick += 1) {
      sim.step(scriptedCommands(tick));
    }
    const eid = findPlayerEntity(sim, 0);
    const renderable = eid === undefined ? undefined : getRenderables(sim).find((renderable) => renderable.eid === eid);
    return {
      ticks: sim.tick,
      hash: hashSnapshot(sim.snapshot()),
      player: renderable ? { x: renderable.x, y: renderable.y } : null,
    };
  } finally {
    sim.destroy();
  }
}

/** Join, walk right, then down, then stop. */
function scriptedCommands(tick: number): Command[] {
  if (tick === 0) return [{ type: 'player/join', slot: 0 }];
  if (tick === SCRIPT.right) return [{ type: 'player/move', slot: 0, x: 1, y: 0 }];
  if (tick === SCRIPT.down) return [{ type: 'player/move', slot: 0, x: 0, y: 1 }];
  if (tick === SCRIPT.stop) return [{ type: 'player/move', slot: 0, x: 0, y: 0 }];
  return [];
}

/** Test-only: lets tests derive expected positions from the script. */
export const __testing__ = { SCRIPT };
