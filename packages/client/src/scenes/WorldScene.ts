import { findPlayerEntity } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { MapCamera } from '../render/camera';
import { EntityRenderer } from '../render/entities';
import { createSpriteAnimations, loadSpriteSheets } from '../render/sprites';
import { loadTerrainSprites, TerrainRenderer, type TerrainReport } from '../render/terrain';
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
  private mapCamera!: MapCamera;
  private terrainRenderer!: TerrainRenderer;

  constructor(private readonly world: PlayableWorld) {
    super('world');
  }

  preload(): void {
    loadSpriteSheets(this);
    loadTerrainSprites(this);
  }

  create(): void {
    createSpriteAnimations(this);
    this.mapCamera = new MapCamera(this.cameras.main, this.world.sim.map);
    this.mapCamera.fitZoomTo(this.scale.width);
    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => this.mapCamera.fitZoomTo(gameSize.width));
    this.terrainRenderer = new TerrainRenderer(this, this.world.sim.map);
    this.entityRenderer = new EntityRenderer(this);
    // The slot travels inside the commands; online it is dropped and the server stamps the seat.
    this.keyboard = createKeyboardInput(this, this.world.localSlot);
    // Dev builds seat extra players with J so one browser can see several avatars; only a world that picks its own seats offers it.
    if (import.meta.env.DEV && this.world.joinAnotherSeat) this.input.keyboard?.on('keydown-J', () => this.world.joinAnotherSeat?.());
    this.entityRenderer.sync(this.world.sim);
    this.followLocalPlayer();
  }

  /** How much terrain is drawn right now, for dev tooling. */
  terrainReport(): TerrainReport {
    return this.terrainRenderer.report();
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.world.nextFrame(this.keyboard.drain(), deltaMs / 1000);
    this.entityRenderer.draw(frame);
    this.followLocalPlayer();
  }

  private followLocalPlayer(): void {
    const eid = findPlayerEntity(this.world.sim, this.world.localSlot);
    const drawnAt = eid === undefined ? undefined : this.entityRenderer.pixelPositionOf(eid);
    if (drawnAt) this.mapCamera.lookAt(drawnAt.x, drawnAt.y);
    // After the camera moved: the terrain near what it shows now is what gets drawn this frame.
    this.terrainRenderer.show(this.mapCamera.view());
  }
}
