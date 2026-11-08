import type { SimHandle } from '@novaland/sim';
import Phaser from 'phaser';

/** CSS pixels, so the text reads the same on every screen. */
const HUD_MARGIN = 12;
const HUD_FONT_SIZE = 14;

/**
 * Dev chrome drawn over the world. It is its own scene so its camera stays
 * at zoom 1 while the world camera zooms; the font is scaled by the pixel
 * ratio instead, which keeps it the same CSS size and crisp on Retina.
 */
export class HudScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;

  constructor(private readonly sim: SimHandle) {
    super('hud');
  }

  create(): void {
    const pixelRatio = window.devicePixelRatio || 1;
    this.text = this.add.text(HUD_MARGIN * pixelRatio, HUD_MARGIN * pixelRatio, '', {
      fontFamily: 'monospace',
      fontSize: `${Math.round(HUD_FONT_SIZE * pixelRatio)}px`,
      color: '#94a3b8',
    });
  }

  override update(): void {
    this.text.setText(`WASD / arrows to move   tick ${this.sim.tick}`);
  }
}
