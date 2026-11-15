import type Phaser from 'phaser';

/** Size of a name on screen, in CSS pixels: the same on every screen and at every camera zoom. */
const NAME_FONT_SIZE = 12;
/** Dark edge around the letters, in CSS pixels, so a name reads over grass, rock and other names. */
const NAME_STROKE = 3;
/**
 * Widest a name may draw, in CSS pixels: about twenty wide letters. A legal
 * name of twenty very wide glyphs would otherwise draw a strip most of a
 * window wide over everyone near it; such a name is drawn smaller instead.
 */
const MAX_NAME_WIDTH = 240;
/** Clear pixels of the world between the top of a character and its name. */
export const NAME_GAP_PIXELS = 2;
/** Names are drawn over everything in the world: entities are depth-sorted by their feet, in pixels, far below this. */
const NAME_DEPTH = 1_000_000_000;

/** What decides how big a label's texture must be for its letters to land one to one on device pixels. */
export interface LabelScale {
  /** Whole-number zoom of the world camera. */
  readonly cameraZoom: number;
  /** Device pixels per CSS pixel. */
  readonly pixelRatio: number;
}

/**
 * The text that shows a player's name above its character. It lives in the
 * world, so it follows the character for free, but its letters are rendered
 * at device resolution and scaled back by the camera zoom (`fitNameLabel`):
 * the world's zoomed pixel art stays blocky, the name stays sharp.
 */
export function createNameLabel(scene: Phaser.Scene, name: string, scale: LabelScale): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, name, { fontFamily: 'system-ui, sans-serif', fontStyle: 'bold', color: '#f8fafc', stroke: '#0b0f14' });
  label.setOrigin(0.5, 1);
  label.setDepth(NAME_DEPTH);
  fitNameLabel(label, scale);
  return label;
}

/** Sizes a label for a camera zoom and a pixel ratio; call again when either changes, and when its text does. */
export function fitNameLabel(label: Phaser.GameObjects.Text, { cameraZoom, pixelRatio }: LabelScale): void {
  label.setFontSize(Math.round(NAME_FONT_SIZE * pixelRatio));
  label.setStroke('#0b0f14', Math.round(NAME_STROKE * pixelRatio));
  label.setScale(scaleWithinWidth({ width: label.width, widest: MAX_NAME_WIDTH * pixelRatio }) / cameraZoom);
}

/** The scale that keeps something `width` wide within `widest`: 1 when it fits, the fraction that shrinks it to `widest` when it does not. */
function scaleWithinWidth({ width, widest }: { width: number; widest: number }): number {
  return width > widest && width > 0 ? widest / width : 1;
}

export const __testing__ = { scaleWithinWidth };
