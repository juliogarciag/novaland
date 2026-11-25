import Phaser from 'phaser';
import { findPlayerEntity } from '@novaland/sim';
import { hudLines, type HudViewFacts } from '../hud/hudLines';
import { HUD_MARGIN } from '../hud/layout';
import { Minimap, type MinimapReport } from '../hud/minimap';
import { minimapPlacement } from '../hud/minimapPlacement';
import { RenderedFrameRate } from '../hud/renderedFrameRate';
import type { ViewFrame } from '../render/viewFrame';
import type { PlayableWorld } from '../worlds/PlayableWorld';

/** CSS pixels, so the text reads the same on every screen. */
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
 *
 * The minimap (hud/minimap.ts) lives here too, for the same reason: it is
 * the same size on screen at every zoom of the world camera. It shows the
 * frame the world scene drew last, so it is centred on the local player
 * where the player sees them (online that position is predicted, ADR 0012).
 */
export class HudScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;
  private minimap!: Minimap;
  /** The furthest right the HUD lines have reached since the canvas last changed size, in device pixels: the minimap is placed against this, so a line gaining a character never moves it. */
  private widestLinesRight = 0;
  private readonly frameRate = new RenderedFrameRate();

  /** `readDrawnFrame` gives the frame the world scene drew last and `readTilesInView` how much of the map its camera shows; both undefined before its first frame. */
  constructor(
    private readonly world: PlayableWorld,
    private readonly readDrawnFrame: () => ViewFrame | undefined,
    private readonly readTilesInView: () => HudViewFacts['tilesInView'],
  ) {
    super({ key: 'hud', active: true });
  }

  create(): void {
    this.text = this.add.text(0, 0, '', { fontFamily: 'monospace', color: HUD_TEXT_COLOR, backgroundColor: HUD_BACKDROP_COLOR });
    this.minimap = new Minimap(this, this.world.sim.map);
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
    this.text.setText(hudLines(this.world, { framesPerSecond: this.frameRate.framesPerSecond, tilesInView: this.readTilesInView() }));
    // After the text: in a narrow window the minimap sits below the lines, whatever they say now.
    this.widestLinesRight = Math.max(this.widestLinesRight, this.text.x + this.text.width);
    this.minimap.place(minimapPlacement({ canvasWidth: this.scale.width, pixelRatio: 1 / this.scale.zoom, hudLines: { right: this.widestLinesRight, bottom: this.text.y + this.text.height } }));
    this.minimap.show({ frame: this.readDrawnFrame(), localEid: findPlayerEntity(this.world.sim, this.world.localSlot) });
  }

  /** What the minimap shows right now, for dev tooling. Undefined until the first frame placed it. */
  minimapReport(): MinimapReport | undefined {
    return this.minimap.report();
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
    this.widestLinesRight = 0;
  }
}
