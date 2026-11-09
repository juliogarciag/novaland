import { createSim, starterLevel, type Command, type SimHandle } from '@novaland/sim';
import { takeWholeTicks } from '../loop/takeWholeTicks';
import { readViewFrame, type ViewFrame } from '../render/viewFrame';
import type { PlayableWorld } from './PlayableWorld';

/** Seat of the one local player. */
export const LOCAL_SLOT = 0;

/** Never simulate more than this much real time per frame (tab switches, hitches). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * Solo play: this client owns the sim and steps it. Real time comes in from
 * the scene, whole sim ticks go out; commands wait in `pendingCommands`
 * until the leftover earns a tick, so the sim only ever advances with real
 * time. The local player joins seat 0 on the first tick.
 */
export class LocalWorld implements PlayableWorld {
  readonly localSlot = LOCAL_SLOT;
  readonly occupancy = undefined;
  private leftover = 0;
  private pendingCommands: Command[] = [{ type: 'player/join', slot: LOCAL_SLOT }];

  constructor(readonly sim: SimHandle) {}

  advance(commands: readonly Command[], deltaSeconds: number): ViewFrame {
    this.pendingCommands.push(...commands);
    const { ticks, leftover } = takeWholeTicks({
      leftover: this.leftover,
      deltaSeconds,
      dt: this.sim.dt,
      maxFrameSeconds: MAX_FRAME_SECONDS,
    });
    this.leftover = leftover;
    for (let tick = 0; tick < ticks; tick += 1) {
      this.sim.step(this.pendingCommands);
      this.pendingCommands = [];
    }
    return readViewFrame(this.sim);
  }
}

/** The solo world: a fresh sim of the starter level with a fixed seed. */
export async function createLocalWorld(): Promise<LocalWorld> {
  return new LocalWorld(await createSim({ seed: 1, level: starterLevel }));
}
