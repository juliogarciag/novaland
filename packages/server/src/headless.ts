import { createSim, hashSnapshot, findPlayerEntity, type Command } from '@novaland/sim';

export interface HeadlessRunOptions {
  readonly ticks: number;
  readonly seed?: number;
}

export interface HeadlessRunResult {
  readonly ticks: number;
  readonly hash: string;
  readonly player: { readonly x: number; readonly y: number } | null;
}

/**
 * Drives a sim with a scripted player for `ticks` ticks. This is the shape of
 * what a server room will do, minus the network.
 */
export async function runHeadless({ ticks, seed = 0 }: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const sim = await createSim({ seed });
  try {
    sim.step([{ type: 'join', slot: 0 }]);
    for (let tick = 1; tick < ticks; tick += 1) {
      sim.step(scriptedCommands(tick));
    }
    const snapshot = sim.snapshot();
    const eid = findPlayerEntity(sim, 0);
    const entity = eid === undefined ? undefined : snapshot.entities.find((e) => e.id === eid);
    const position = entity?.components['Position'];
    return {
      ticks: sim.tick,
      hash: hashSnapshot(snapshot),
      player: position ? { x: position['x'] ?? 0, y: position['y'] ?? 0 } : null,
    };
  } finally {
    sim.destroy();
  }
}

/** Walk right, then down, then stop. */
function scriptedCommands(tick: number): Command[] {
  if (tick === 1) return [{ type: 'move', slot: 0, x: 1, y: 0 }];
  if (tick === 120) return [{ type: 'move', slot: 0, x: 0, y: 1 }];
  if (tick === 240) return [{ type: 'move', slot: 0, x: 0, y: 0 }];
  return [];
}
