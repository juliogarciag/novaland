import { findPlayerEntity, getDef, getRenderables, isAvatarDefId, type SimHandle } from '@novaland/sim';
import Phaser from 'phaser';
import { LOCAL_SLOT } from '../seats';

/** CSS pixels, so the text reads the same on every screen. */
const HUD_MARGIN = 12;
const HUD_FONT_SIZE = 14;

/**
 * Dev chrome drawn over the world. It is its own scene so its camera stays
 * at zoom 1 while the world camera zooms; the text is scaled by the pixel
 * ratio instead, which keeps it the same CSS size and crisp on Retina.
 */
export class HudScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;

  constructor(private readonly sim: SimHandle) {
    super({ key: 'hud', active: true });
  }

  create(): void {
    this.text = this.add.text(0, 0, '', { fontFamily: 'monospace', color: '#94a3b8' });
    this.fitToPixelRatio();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitToPixelRatio, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitToPixelRatio, this));
  }

  override update(): void {
    const renderables = getRenderables(this.sim);
    const players = renderables.filter((renderable) => isAvatarDefId(renderable.defId));
    const localEid = findPlayerEntity(this.sim, LOCAL_SLOT);
    const local = players.find((player) => player.eid === localEid);
    const lines = [`WASD / arrows to move   tick ${this.sim.tick}`, `you: ${local ? getDef(local.defId).name : 'joining...'}   players: ${players.length}`];
    if (import.meta.env.DEV) lines.push('J: seat another player (dev)');
    this.text.setText(lines);
  }

  /** The canvas is zoomed by 1 / pixelRatio (render/viewport.ts), so device pixels per CSS pixel is the inverse. */
  private fitToPixelRatio(): void {
    const pixelRatio = 1 / this.scale.zoom;
    this.text.setFontSize(Math.round(HUD_FONT_SIZE * pixelRatio));
    this.text.setPosition(HUD_MARGIN * pixelRatio, HUD_MARGIN * pixelRatio);
  }
}
