import { createSim, generatedWorldMap, guestCharacter, type Character, type Command, type SimHandle, type WorldMap } from '@novaland/sim';
import { takeWholeTicks } from '../loop/takeWholeTicks';
import { readViewFrame, type ViewFrame } from '../render/viewFrame';
import { firstEmptySeat, LOCAL_SLOT } from '../seats';
import type { PlayableWorld } from './PlayableWorld';

/** Never simulate more than this much real time per frame (tab switches, hitches). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * Solo play: this client owns the sim and steps it. Real time comes in from
 * the scene, whole sim ticks go out; commands wait in `pendingCommands`
 * until the leftover earns a tick, so the sim only ever advances with real
 * time. The local player joins seat 0 on the first tick, as the character
 * they made.
 */
export class LocalWorld implements PlayableWorld {
  readonly localSlot = LOCAL_SLOT;
  readonly occupancy = undefined;
  readonly latencyMs = undefined;
  private leftover = 0;
  private pendingCommands: Command[];

  constructor(
    readonly sim: SimHandle,
    character: Character,
  ) {
    this.pendingCommands = [{ type: 'player/join', slot: LOCAL_SLOT, character }];
  }

  nextFrame(commands: readonly Command[], deltaSeconds: number): ViewFrame {
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

  queueCommand(command: Command): void {
    this.pendingCommands.push(command);
  }

  changeCharacter(character: Character): void {
    this.queueCommand({ type: 'player/change-character', slot: this.localSlot, character });
  }

  joinAnotherSeat(): void {
    const slot = firstEmptySeat(this.sim, this.pendingCommands);
    if (slot !== undefined) this.queueCommand({ type: 'player/join', slot, character: guestCharacter(slot) });
  }
}

/**
 * The solo world: a fresh sim of the world with a fixed seed, played as
 * `character`. `generatedMap`
 * (`VITE_GENERATED_MAP`, dev builds only) swaps the world for a generated one
 * of that size, such as "400x300", to measure how the client copes with a big map.
 */
export async function createLocalWorld({ character, generatedMap }: { character: Character; generatedMap?: string | undefined }): Promise<LocalWorld> {
  const map = generatedMap === undefined ? undefined : generatedMapOfSize(generatedMap);
  return new LocalWorld(await createSim(map ? { seed: 1, map } : { seed: 1 }), character);
}

/** The generated map a size such as "400x300" asks for. Throws for anything else: a measurement on the wrong map is worse than none. */
function generatedMapOfSize(size: string): WorldMap {
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(size);
  if (!match) throw new Error(`VITE_GENERATED_MAP must look like 400x300, got "${size}"`);
  return generatedWorldMap({ columns: Number(match[1]), rows: Number(match[2]) });
}
