/**
 * Generates the mouse cursor the page shows over the game: the classic arrow
 * in white with a dark outline and a grey shaded right edge (ticket #49).
 *
 * The design is the rows and the palette below, 16x16 pixels, and nothing
 * else: to change the cursor, edit them and run this again. It is written
 * twice, both times as whole blocks of one colour so it stays crisp:
 *
 *   public/cursors/arrow.png     32x32, every design pixel 2x2: what an ordinary screen shows
 *   public/cursors/arrow@2x.png  64x64, every design pixel 4x4: the same 32 CSS pixels on a 2x (Retina) screen
 *
 * The page names both in the `cursor` rule of index.html, with the hotspot
 * (the pixel that clicks) at the tip of the arrow. A test holds the rule and
 * these constants together.
 *
 * Plain Node, no dependencies; the pixel canvas and the PNG encoder are shared with the sprite sheets.
 *
 *   node tools/generate-arrow-cursor.mjs                # writes public/cursors/arrow.png and arrow@2x.png
 *   node tools/generate-arrow-cursor.mjs --out <dir>    # writes them somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './generate-player-sheet.mjs';
import { createCanvas, pixel } from './pixelCanvas.mjs';

/** The design is this many pixels wide and tall. */
export const ARROW_CURSOR_DESIGN_SIZE = 16;

/** One design pixel covers this many CSS pixels on screen, each way. */
export const ARROW_CURSOR_SCALE = 2;

/** The cursor's size on screen, in CSS pixels. */
export const ARROW_CURSOR_CSS_SIZE = ARROW_CURSOR_DESIGN_SIZE * ARROW_CURSOR_SCALE;

/** The design pixel that clicks: the tip of the arrow. The same point in CSS pixels, since it is the top-left corner. */
export const ARROW_CURSOR_HOTSPOT = { x: 0, y: 0 };

/** The colour of each character of the rows. `.` and whatever a short row leaves out are transparent. */
export const ARROW_CURSOR_PALETTE = {
  X: [0x1b, 0x1b, 0x2a], // outline
  o: [0xff, 0xff, 0xff], // fill
  s: [0xaa, 0xb4, 0xc2], // shaded edge
};

/** Top to bottom; a row shorter than the design is transparent to its right. */
export const ARROW_CURSOR_ROWS = [
  'X',
  'XX',
  'XsX',
  'XosX',
  'XoosX',
  'XooosX',
  'XoooosX',
  'XooooosX',
  'XoooooosX',
  'XoooooossX',
  'XoooooXXXXX',
  'XooXosX',
  'XoX.XosX',
  'XX..XosX',
  'X....XssX',
  '.....XXX',
];

/** The files written, by how many device pixels a CSS pixel has on the screen they are for. */
export const ARROW_CURSOR_FILES = [
  { name: 'arrow.png', devicePixelsPerCssPixel: 1 },
  { name: 'arrow@2x.png', devicePixelsPerCssPixel: 2 },
];

const TRANSPARENT = '.';

/** The cursor with every design pixel painted as a block of `blockSize` x `blockSize` pixels. */
export function paintArrowCursor(blockSize) {
  if (!Number.isInteger(blockSize) || blockSize < 1) throw new Error(`a design pixel must cover a whole number of pixels, got ${blockSize}`);
  if (ARROW_CURSOR_ROWS.length > ARROW_CURSOR_DESIGN_SIZE) throw new Error(`the design has ${ARROW_CURSOR_ROWS.length} rows, more than ${ARROW_CURSOR_DESIGN_SIZE}`);
  const canvas = createCanvas(ARROW_CURSOR_DESIGN_SIZE * blockSize, ARROW_CURSOR_DESIGN_SIZE * blockSize);
  ARROW_CURSOR_ROWS.forEach((row, y) => {
    if (row.length > ARROW_CURSOR_DESIGN_SIZE) throw new Error(`row ${y} is ${row.length} pixels wide, more than ${ARROW_CURSOR_DESIGN_SIZE}`);
    [...row].forEach((character, x) => {
      if (character === TRANSPARENT) return;
      const color = ARROW_CURSOR_PALETTE[character];
      if (!color) throw new Error(`row ${y} has '${character}', which the palette does not name`);
      for (let blockY = 0; blockY < blockSize; blockY += 1) {
        for (let blockX = 0; blockX < blockSize; blockX += 1) pixel(canvas, x * blockSize + blockX, y * blockSize + blockY, color);
      }
    });
  });
  return canvas;
}

/** Writes the cursor files into `directory` and returns their paths. */
export function writeArrowCursor(directory) {
  mkdirSync(directory, { recursive: true });
  return ARROW_CURSOR_FILES.map(({ name, devicePixelsPerCssPixel }) => {
    const file = path.join(directory, name);
    writeFileSync(file, encodePng(paintArrowCursor(ARROW_CURSOR_SCALE * devicePixelsPerCssPixel)));
    return file;
  });
}

const DEFAULT_OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/cursors');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the cursor goes to public/cursors');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  for (const file of writeArrowCursor(directory)) console.log(`wrote ${file}`);
}
