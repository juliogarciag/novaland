import { findPlayerEntity } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { LevelCamera } from '../render/camera';
import { EntityRenderer } from '../render/entities';
import { createSpriteAnimations, loadSpriteSheets } from '../render/sprites';
import { drawTerrain } from '../render/terrain';
import type { PlayableWorld } from '../worlds/PlayableWorld';

/**
 * The world scene: draws whatever the playable world says and hands it the
 * keyboard's commands. Solo the world steps a sim, online it talks to the
 * server; the scene does neither and never touches game rules. The camera
 * follows the local seat's entity.
 */
export class WorldScene extends Phaser.Scene {
  private keyboard!: KeyboardInput;
  private entityRenderer!: EntityRenderer;
  private levelCamera!: LevelCamera;

  constructor(private readonly world: PlayableWorld) {
    super('world');
  }

  preload(): void {
    loadSpriteSheets(this);
  }

  create(): void {
    createSpriteAnimations(this);
    this.levelCamera = new LevelCamera(this.cameras.main, this.world.sim.level);
    this.levelCamera.fitZoomTo(this.scale.width);
    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => this.levelCamera.fitZoomTo(gameSize.width));
    drawTerrain(this, this.world.sim.level);
    this.entityRenderer = new EntityRenderer(this);
    // The slot travels inside the commands; online it is dropped and the server stamps the seat.
    this.keyboard = createKeyboardInput(this, this.world.localSlot);
    this.entityRenderer.sync(this.world.sim);
    this.followLocalPlayer();
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.world.nextFrame(this.keyboard.drain(), deltaMs / 1000);
    this.entityRenderer.draw(frame);
    this.followLocalPlayer();
  }

  private followLocalPlayer(): void {
    const eid = findPlayerEntity(this.world.sim, this.world.localSlot);
    const drawnAt = eid === undefined ? undefined : this.entityRenderer.pixelPositionOf(eid);
    if (drawnAt) this.levelCamera.lookAt(drawnAt.x, drawnAt.y);
  }
}
