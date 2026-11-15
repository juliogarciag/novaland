import type Phaser from 'phaser';

/** The pixel font names are drawn in: the same blocky letters as the world's art. Other scripts and emoji fall back to the system's font. */
const NAME_FONT_FAMILY = 'Tiny5';
const NAME_FONT_STACK = `"${NAME_FONT_FAMILY}", system-ui, sans-serif`;
/**
 * Size of a name, in world pixels. It is the grid the font was drawn on: at
 * this size one pixel of a letter is exactly one pixel of the world, so the
 * letters are as blocky as the character under them at every camera zoom.
 */
const NAME_FONT_PIXELS = 8;
/** Dark edge around the letters, in world pixels, so a name reads over grass, rock and other names. */
const NAME_EDGE_PIXELS = 1;
/**
 * Widest a name may draw, in world pixels: about twenty wide letters. A legal
 * name of twenty very wide glyphs would otherwise draw a strip most of a
 * window wide over everyone near it; such a name is drawn smaller instead.
 */
const MAX_NAME_WIDTH_PIXELS = 128;
/** Clear pixels of the world between the top of a character and its name. */
export const NAME_GAP_PIXELS = 1;
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
 * pixel of the font covers exactly one pixel of the world, and a glyph the
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
  label.setFontSize(NAME_FONT_PIXELS * cameraZoom);
  // A stroke is centred on the outline: twice the edge wide leaves one edge outside the letter.
  label.setStroke('#0b0f14', 2 * NAME_EDGE_PIXELS * cameraZoom);
  label.setScale(scaleWithinWidth({ width: label.width, widest: MAX_NAME_WIDTH_PIXELS * cameraZoom }) / cameraZoom);
}

/** The scale that keeps something `width` wide within `widest`: 1 when it fits, the fraction that shrinks it to `widest` when it does not. */
function scaleWithinWidth({ width, widest }: { width: number; widest: number }): number {
  return width > widest && width > 0 ? widest / width : 1;
}

export const __testing__ = { scaleWithinWidth };
