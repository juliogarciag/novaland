import type { Command, SimHandle } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { takeWholeTicks } from '../loop/takeWholeTicks';
import { EntityRenderer } from '../render/entities';

/** Seat of the local player. Multiplayer will assign this from the server. */
const LOCAL_SLOT = 0;

/** Never simulate more than this much real time per frame (tab switches, hitches). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * The one scene for now. Owns the leftover frame time: real time comes in
 * from Phaser, whole sim ticks go out. Commands wait in `pending` until the
 * leftover earns a tick, so the sim only ever advances with real time.
 * The scene never touches game rules.
 */
export class WorldScene extends Phaser.Scene {
  private leftover = 0;
  private pending: Command[] = [];
  private keyboard!: KeyboardInput;
  private entities!: EntityRenderer;
  private hud!: Phaser.GameObjects.Text;

  constructor(private readonly sim: SimHandle) {
    super('world');
  }

  create(): void {
    this.cameras.main.centerOn(0, 0);
    this.entities = new EntityRenderer(this);
    this.keyboard = createKeyboardInput(this, LOCAL_SLOT);
    this.hud = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#94a3b8' })
      .setScrollFactor(0);
    this.pending.push({ type: 'player/join', slot: LOCAL_SLOT });
    this.entities.sync(this.sim);
  }

  override update(_time: number, deltaMs: number): void {
    this.pending.push(...this.keyboard.drain());
    const { ticks, leftover } = takeWholeTicks(this.leftover, deltaMs / 1000, this.sim.dt, MAX_FRAME_SECONDS);
    this.leftover = leftover;
    for (let i = 0; i < ticks; i += 1) {
      this.sim.step(this.pending);
      this.pending = [];
    }
    this.entities.sync(this.sim);
    this.hud.setText(`WASD / arrows to move   tick ${this.sim.tick}`);
  }
}
