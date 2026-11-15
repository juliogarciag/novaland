import Phaser from 'phaser';
import { hudLines } from '../hud/hudLines';
import { RenderedFrameRate } from '../hud/renderedFrameRate';
import type { PlayableWorld } from '../worlds/PlayableWorld';

/** CSS pixels, so the text reads the same on every screen. */
const HUD_MARGIN = 12;
const HUD_FONT_SIZE = 14;
/** Space between the text and the edge of its backdrop, in CSS pixels. */
const HUD_PADDING = { x: 10, y: 8 };
const HUD_TEXT_COLOR = '#e2e8f0';
/** Dark enough that the text keeps a contrast above 4.5:1 over a white tile, clear enough to see the world through. */
const HUD_BACKDROP_COLOR = 'rgba(11, 15, 20, 0.75)';

/**
 * Dev chrome drawn over the world. It is its own scene so its camera stays
 * at zoom 1 while the world camera zooms; the text is scaled by the pixel
 * ratio instead, which keeps it the same CSS size and crisp on Retina.
 *
 * The backdrop is the text object's own background: Phaser fills it behind
 * the text and its padding whenever the text is redrawn, so it has the
 * text's size for any content, font size or pixel ratio.
 */
export class HudScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;
  private readonly frameRate = new RenderedFrameRate();

  constructor(private readonly world: PlayableWorld) {
    super({ key: 'hud', active: true });
  }

  create(): void {
    this.text = this.add.text(0, 0, '', { fontFamily: 'monospace', color: HUD_TEXT_COLOR, backgroundColor: HUD_BACKDROP_COLOR });
    this.fitToPixelRatio();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitToPixelRatio, this);
    // Counted where the scene is drawn, not where it updates: a frame that was not rendered is not a frame the player saw.
    this.events.on(Phaser.Scenes.Events.RENDER, this.countRenderedFrame, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitToPixelRatio, this);
      this.events.off(Phaser.Scenes.Events.RENDER, this.countRenderedFrame, this);
    });
  }

  override update(): void {
    this.text.setText(hudLines(this.world, { framesPerSecond: this.frameRate.framesPerSecond }));
  }

  private countRenderedFrame(): void {
    this.frameRate.frameRendered(performance.now());
  }

  /** The canvas is zoomed by 1 / pixelRatio (render/viewport.ts), so device pixels per CSS pixel is the inverse. */
  private fitToPixelRatio(): void {
    const pixelRatio = 1 / this.scale.zoom;
    this.text.setFontSize(Math.round(HUD_FONT_SIZE * pixelRatio));
    this.text.setPadding(Math.round(HUD_PADDING.x * pixelRatio), Math.round(HUD_PADDING.y * pixelRatio));
    this.text.setPosition(HUD_MARGIN * pixelRatio, HUD_MARGIN * pixelRatio);
  }
}
