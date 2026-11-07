import type { Command, Sim } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { EntityRenderer } from '../render/entities';

/** Seat of the local player. Multiplayer will assign this from the server. */
const LOCAL_SLOT = 0;

/** Never simulate more than this much real time per frame (tab switches, hitches). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * The one scene for now. Owns the fixed-step accumulator: real time comes in
 * from Phaser, whole sim ticks go out. The scene never touches game rules.
 */
export class WorldScene extends Phaser.Scene {
  private accumulator = 0;
  private keyboard!: KeyboardInput;
  private entities!: EntityRenderer;
  private hud!: Phaser.GameObjects.Text;

  constructor(private readonly sim: Sim) {
    super('world');
  }

  create(): void {
    this.cameras.main.centerOn(0, 0);
    this.entities = new EntityRenderer(this);
    this.keyboard = createKeyboardInput(this, LOCAL_SLOT);
    this.hud = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#94a3b8' })
      .setScrollFactor(0);
    this.sim.step([{ type: 'join', slot: LOCAL_SLOT }]);
    this.entities.sync(this.sim);
  }

  override update(_time: number, deltaMs: number): void {
    this.accumulator += Math.min(deltaMs / 1000, MAX_FRAME_SECONDS);
    let commands: Command[] = this.keyboard.drain();
    while (this.accumulator >= this.sim.dt) {
      this.sim.step(commands);
      commands = [];
      this.accumulator -= this.sim.dt;
    }
    // Input that arrived on a frame without a tick still has to reach the sim.
    if (commands.length > 0) this.sim.step(commands);
    this.entities.sync(this.sim);
    this.hud.setText(`WASD / arrows to move   tick ${this.sim.tick}`);
  }
}
