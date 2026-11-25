import { findPlayerEntity } from '@novaland/sim';
import Phaser from 'phaser';
import { createKeyboardInput, type KeyboardInput } from '../input/keyboard';
import { wheelStepOf, type WheelStep } from '../input/wheel';
import { MapCamera, type ZoomReport } from '../render/camera';
import { EntityRenderer } from '../render/entities';
import { createSpriteAnimations, loadSpriteSheets } from '../render/sprites';
import { loadTerrainSprites, TerrainRenderer, type TerrainReport } from '../render/terrain';
import { terrainDetailAt } from '../render/terrainDetail';
import type { ViewFrame } from '../render/viewFrame';
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
  private lastDrawnFrame: ViewFrame | undefined;

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
    this.mapCamera.fitZoomTo(this.scale);
    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => this.mapCamera.fitZoomTo(gameSize));
    this.terrainRenderer = new TerrainRenderer(this, this.world.sim.map);
    this.entityRenderer = new EntityRenderer(this);
    // The slot travels inside the commands; online it is dropped and the server stamps the seat.
    this.keyboard = createKeyboardInput(this, this.world.localSlot);
    // Dev builds seat extra players with J so one browser can see several characters; only a world that picks its own seats offers it.
    if (import.meta.env.DEV && this.world.joinAnotherSeat) this.input.keyboard?.on('keydown-J', () => this.world.joinAnotherSeat?.());
    // Dev builds zoom with the mouse wheel, to look at how big the map is. A view fact: the sim never hears of it.
    if (import.meta.env.DEV) this.zoomWithMouseWheel();
    this.entityRenderer.sync(this.world.sim);
    this.followLocalPlayer();
  }

  /** Where the mouse wheel has the camera, for dev tooling. */
  zoomReport(): ZoomReport {
    return this.mapCamera.zoomReport();
  }

  /** How much of the map is on screen, in tiles, for the HUD; undefined until the scene runs. */
  tilesInView(): { across: number; down: number } | undefined {
    return this.scene.isActive() ? this.mapCamera.tilesInView() : undefined;
  }

  /** How much terrain is drawn right now, for dev tooling. */
  terrainReport(): TerrainReport {
    return this.terrainRenderer.report();
  }

  /** The frame drawn last, for the HUD to show the same positions; undefined before the first. */
  get drawnFrame(): ViewFrame | undefined {
    return this.lastDrawnFrame;
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.world.nextFrame(this.keyboard.drain(), deltaMs / 1000);
    this.lastDrawnFrame = frame;
    this.entityRenderer.draw(frame);
    this.followLocalPlayer();
  }

  /** The names drawn above characters right now. For end-to-end checks. */
  drawnNames(): ReturnType<EntityRenderer['drawnNames']> {
    return this.entityRenderer.drawnNames();
  }

  /** Wheel down zooms out, wheel up zooms back in. The camera stays on the player, so that is what the zoom is around. */
  private zoomWithMouseWheel(): void {
    let lastStep: WheelStep | undefined;
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (pointer: Phaser.Input.Pointer) => {
      const step = wheelStepOf({ deltaY: pointer.deltaY, timeMs: pointer.event.timeStamp, lastStep });
      if (!step) return;
      lastStep = step;
      this.mapCamera.zoomOut(step.steps);
      // Now, not at the next frame: what the camera shows has to match its zoom before anything is drawn with it.
      this.followLocalPlayer();
    });
  }

  private followLocalPlayer(): void {
    const eid = findPlayerEntity(this.world.sim, this.world.localSlot);
    const drawnAt = eid === undefined ? undefined : this.entityRenderer.pixelPositionOf(eid);
    if (drawnAt) this.mapCamera.lookAt(drawnAt.x, drawnAt.y);
    // After the camera moved: the terrain near what it shows now is what gets drawn this frame.
    // One colour per tile is a texture made from bytes, which only WebGL can do; the canvas renderer keeps the art.
    this.terrainRenderer.show(this.mapCamera.view(), this.game.renderer.type === Phaser.WEBGL ? terrainDetailAt(this.cameras.main.zoom) : 'art');
  }
}
