import { findPlayerEntity, type Command, type SimHandle } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { takeWholeTicks } from '../loop/takeWholeTicks';
import { LevelCamera } from '../render/camera';
import { EntityRenderer } from '../render/entities';
import { createSpriteAnimations, loadSpriteSheets } from '../render/sprites';

/** Seat of the local player. Multiplayer will assign this from the server. */
const LOCAL_SLOT = 0;

/** Never simulate more than this much real time per frame (tab switches, hitches). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * The world scene. Owns the leftover frame time: real time comes in
 * from Phaser, whole sim ticks go out. Commands wait in `pendingCommands` until the
 * leftover earns a tick, so the sim only ever advances with real time.
 * The camera follows the local player. The scene never touches game rules.
 */
export class WorldScene extends Phaser.Scene {
  private leftover = 0;
  private pendingCommands: Command[] = [];
  private keyboard!: KeyboardInput;
  private entityRenderer!: EntityRenderer;
  private levelCamera!: LevelCamera;

  constructor(private readonly sim: SimHandle) {
    super('world');
  }

  preload(): void {
    loadSpriteSheets(this);
  }

  create(): void {
    createSpriteAnimations(this);
    this.levelCamera = new LevelCamera(this.cameras.main, this.sim.level);
    this.levelCamera.fitZoomTo(this.scale.width);
    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => this.levelCamera.fitZoomTo(gameSize.width));
    this.entityRenderer = new EntityRenderer(this);
    this.keyboard = createKeyboardInput(this, LOCAL_SLOT);
    this.pendingCommands.push({ type: 'player/join', slot: LOCAL_SLOT });
    this.entityRenderer.sync(this.sim);
    this.followLocalPlayer();
  }

  override update(_time: number, deltaMs: number): void {
    this.pendingCommands.push(...this.keyboard.drain());
    const { ticks, leftover } = takeWholeTicks({
      leftover: this.leftover,
      deltaSeconds: deltaMs / 1000,
      dt: this.sim.dt,
      maxFrameSeconds: MAX_FRAME_SECONDS,
    });
    this.leftover = leftover;
    for (let i = 0; i < ticks; i += 1) {
      this.sim.step(this.pendingCommands);
      this.pendingCommands = [];
    }
    this.entityRenderer.sync(this.sim);
    this.followLocalPlayer();
  }

  private followLocalPlayer(): void {
    const eid = findPlayerEntity(this.sim, LOCAL_SLOT);
    const drawnAt = eid === undefined ? undefined : this.entityRenderer.pixelPositionOf(eid);
    if (drawnAt) this.levelCamera.lookAt(drawnAt.x, drawnAt.y);
  }
}
