import type Phaser from 'phaser';
import { PIXELS_PER_METRE, toPixels } from './units';

/** The pixel font names are drawn in: the same blocky letters as the world's art. Other scripts and emoji fall back to the system's font. */
const NAME_FONT_FAMILY = 'Tiny5';
const NAME_FONT_STACK = `"${NAME_FONT_FAMILY}", system-ui, sans-serif`;
/** The grid the font was drawn on: at a font size of this many pixels, one pixel of a letter is one pixel. */
const NAME_FONT_GRID = 8;
/**
 * How big one pixel of a letter is, in metres. Letters as coarse as the
 * world's first art, a sixteenth of a metre, made names too big next to a
 * character; a little finer keeps them blocky and lets them sit quietly.
 * In metres, so a name stays the size it is on screen whatever the pixels
 * per metre of the art.
 */
const LETTER_PIXEL_METRES = 0.6 / 16;
/** Dark edge around the letters, in pixels of a letter, so a name reads over grass, rock and other names. */
const NAME_EDGE = 1;
/**
 * Widest a name may draw, in pixels of a letter: about twenty wide letters. A
 * legal name of twenty very wide glyphs would otherwise draw a strip most of
 * a window wide over everyone near it; such a name is drawn smaller instead.
 */
const MAX_NAME_WIDTH = 128;
/** Clear space between the top of a character and its name, in metres, and in pixels of the world. */
const NAME_GAP_METRES = 1 / 16;
export const NAME_GAP_PIXELS = toPixels(NAME_GAP_METRES);
/** Names are drawn over everything in the world: entities are depth-sorted by their feet, in pixels, far below this. */
const NAME_DEPTH = 1_000_000_000;

/**
 * Resolves when the name font is ready to draw, every script it covers
 * included, so no label is ever measured in a fallback font. It never
 * rejects: without the font (offline, a blocked file) names draw in the
 * system's font.
 */
export async function loadNameFont(fonts: FontFaceSet = document.fonts): Promise<void> {
  const faces = [...fonts].filter((face) => face.family.replace(/["']/g, '') === NAME_FONT_FAMILY);
  await Promise.allSettled(faces.map((face) => face.load()));
}

/**
 * The text that shows a player's name above its character. It lives in the
 * world, so it follows the character for free. Its letters are rendered for
 * the camera's whole-number zoom and scaled back by it (`fitNameLabel`): a
 * pixel of a letter covers a whole number of device pixels, and a glyph the
 * pixel font lacks (an emoji, another script) is still drawn sharp.
 */
export function createNameLabel(scene: Phaser.Scene, name: string, cameraZoom: number): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, name, { fontFamily: NAME_FONT_STACK, color: '#f8fafc', stroke: '#0b0f14' });
  label.setOrigin(0.5, 1);
  label.setDepth(NAME_DEPTH);
  fitNameLabel(label, cameraZoom);
  return label;
}

/** Sizes a label for the world camera's zoom; call again when the zoom changes, and when the label's text does. */
export function fitNameLabel(label: Phaser.GameObjects.Text, cameraZoom: number): void {
  const letterPixel = letterPixelFor(cameraZoom);
  label.setFontSize(NAME_FONT_GRID * letterPixel);
  // A stroke is centred on the outline: twice the edge wide leaves one edge outside the letter.
  label.setStroke('#0b0f14', 2 * NAME_EDGE * letterPixel);
  label.setScale(scaleWithinWidth({ width: label.width, widest: MAX_NAME_WIDTH * letterPixel }) / cameraZoom);
}

/** Device pixels one pixel of a letter covers at a camera zoom: a whole number, so every letter pixel is the same crisp square. */
function letterPixelFor(cameraZoom: number): number {
  return Math.max(1, Math.round(cameraZoom * PIXELS_PER_METRE * LETTER_PIXEL_METRES));
}

/** The scale that keeps something `width` wide within `widest`: 1 when it fits, the fraction that shrinks it to `widest` when it does not. */
function scaleWithinWidth({ width, widest }: { width: number; widest: number }): number {
  return width > widest && width > 0 ? widest / width : 1;
}

export const __testing__ = { scaleWithinWidth, letterPixelFor };
