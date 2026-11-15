/**
 * Generates the mouse cursors the page shows over the game (ticket #49).
 *
 * A cursor is the rows and the palette of its entry in CURSOR_DESIGNS,
 * 16x16 pixels, and nothing else: to change one, edit its entry and run this
 * again. Each is written twice, both times as whole blocks of one colour so
 * it stays crisp:
 *
 *   public/cursors/<name>.png     32x32, every design pixel 2x2: what an ordinary screen shows
 *   public/cursors/<name>@2x.png  64x64, every design pixel 4x4: the same 32 CSS pixels on a 2x (Retina) screen
 *
 * The page picks between them in src/render/cursors.ts, which lists the same
 * names and hotspots; a test holds the two lists together. Crisp means pixel
 * ratios 1 and 2: at 1.25 or 1.5 the browser resamples one of the files.
 *
 * Plain Node, no dependencies; the pixel canvas and the PNG encoder are shared with the sprite sheets.
 *
 *   node tools/generate-cursors.mjs                # writes public/cursors/<name>.png and <name>@2x.png
 *   node tools/generate-cursors.mjs --out <dir>    # writes them somewhere else (used by verifications)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './generate-player-sheet.mjs';
import { createCanvas, pixel } from './pixelCanvas.mjs';

/** Every design is this many pixels wide and tall. */
export const CURSOR_DESIGN_SIZE = 16;

/** One design pixel covers this many CSS pixels on screen, each way. */
export const CURSOR_SCALE = 2;

/** A cursor's size on screen, in CSS pixels. */
export const CURSOR_CSS_SIZE = CURSOR_DESIGN_SIZE * CURSOR_SCALE;

/** The files written for each cursor, by how many device pixels a CSS pixel has on the screen they are for. */
export const CURSOR_SCREENS = [
  { suffix: '', devicePixelsPerCssPixel: 1 },
  { suffix: '@2x', devicePixelsPerCssPixel: 2 },
];

/**
 * One entry per cursor. `rows` go top to bottom; a row shorter than the
 * design is transparent to its right, and so is `.`. `palette` gives each
 * other character its colour as [red, green, blue] or, for a see-through
 * pixel such as a shadow, [red, green, blue, alpha]. `hotspot` is the design
 * pixel that clicks.
 */
export const CURSOR_DESIGNS = [
  {
    // A short, fat arrow in the warm colours of the world: flat top, flat left side, thick stem.
    name: 'warm-arrow',
    hotspot: { x: 0, y: 0 },
    palette: {
      X: [0x3b, 0x1f, 0x16], // outline
      h: [0xff, 0xd9, 0x8a], // lit edge
      o: [0xf0, 0x9a, 0x4a], // fill
      s: [0xc0, 0x62, 0x30], // shaded edge
    },
    rows: [
      'XXXXXXXXXXX',
      'XhhhhhhhhsX',
      'XhoooooosX',
      'XhooooosX',
      'XhoooosX',
      'XhooooooX',
      'XhoooooooX',
      'XhosXsooooX',
      'XhsX.XsooooX',
      'XsX...XsooooX',
      'XX.....XsoosX',
      '........XsssX',
      '.........XXX',
    ],
  },
  {
    // An arrow with no tail: a dark dart in two tones split from the tip to the notch at its back, over a soft shadow.
    name: 'dark-dart',
    hotspot: { x: 0, y: 0 },
    palette: {
      X: [0x0e, 0x10, 0x20], // outline
      l: [0x5a, 0x6a, 0xa0], // lit half
      d: [0x2c, 0x35, 0x58], // dark half
      z: [0x00, 0x00, 0x00, 0x60], // shadow
    },
    rows: [
      'X',
      'XXz',
      'XlXz',
      'XldXz',
      'XlddXz',
      'XllddXz',
      'XlldddXz',
      'XllddddXz',
      'XlllddddXz',
      'XllldddddXz',
      'XlllldddddXz',
      'XlllXXXXXXXz',
      'XllXzzzzzzzz',
      'XlXz',
      'XXz',
      '.zz',
    ],
  },
  {
    // The dark dart in the browns of the world: the same shape, bark and earth instead of blue.
    name: 'brown-dart',
    hotspot: { x: 0, y: 0 },
    palette: {
      X: [0x1c, 0x0f, 0x0a], // outline
      l: [0x8a, 0x5a, 0x3a], // lit half
      d: [0x4a, 0x2c, 0x1c], // dark half
      z: [0x00, 0x00, 0x00, 0x60], // shadow
    },
    rows: [
      'X',
      'XXz',
      'XlXz',
      'XldXz',
      'XlddXz',
      'XllddXz',
      'XlldddXz',
      'XllddddXz',
      'XlllddddXz',
      'XllldddddXz',
      'XlllldddddXz',
      'XlllXXXXXXXz',
      'XllXzzzzzzzz',
      'XlXz',
      'XXz',
      '.zz',
    ],
  },
  {
    // The classic pointer in white with a grey shaded right edge: the first design of the ticket, kept to compare.
    name: 'shaded-arrow',
    hotspot: { x: 0, y: 0 },
    palette: {
      X: [0x1b, 0x1b, 0x2a], // outline
      o: [0xff, 0xff, 0xff], // fill
      s: [0xaa, 0xb4, 0xc2], // shaded edge
    },
    rows: [
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
    ],
  },
];

const TRANSPARENT = '.';
const OPAQUE = 255;

/** The cursor of `design` with every design pixel painted as a block of `blockSize` x `blockSize` pixels. */
export function paintCursor(design, blockSize) {
  if (!Number.isInteger(blockSize) || blockSize < 1) throw new Error(`a design pixel must cover a whole number of pixels, got ${blockSize}`);
  if (design.rows.length > CURSOR_DESIGN_SIZE) throw new Error(`${design.name} has ${design.rows.length} rows, more than ${CURSOR_DESIGN_SIZE}`);
  const canvas = createCanvas(CURSOR_DESIGN_SIZE * blockSize, CURSOR_DESIGN_SIZE * blockSize);
  design.rows.forEach((row, y) => {
    if (row.length > CURSOR_DESIGN_SIZE) throw new Error(`row ${y} of ${design.name} is ${row.length} pixels wide, more than ${CURSOR_DESIGN_SIZE}`);
    [...row].forEach((character, x) => {
      if (character === TRANSPARENT) return;
      const color = design.palette[character];
      if (!color) throw new Error(`row ${y} of ${design.name} has '${character}', which its palette does not name`);
      const [red, green, blue, alpha = OPAQUE] = color;
      for (let blockY = 0; blockY < blockSize; blockY += 1) {
        for (let blockX = 0; blockX < blockSize; blockX += 1) pixel(canvas, x * blockSize + blockX, y * blockSize + blockY, [red, green, blue], alpha);
      }
    });
  });
  return canvas;
}

/** The name of the file of the cursor called `name` for one of CURSOR_SCREENS. */
export function cursorFileName(name, screen) {
  return `${name}${screen.suffix}.png`;
}

/** Writes every cursor's files into `directory` and returns their paths. */
export function writeCursors(directory) {
  mkdirSync(directory, { recursive: true });
  return CURSOR_DESIGNS.flatMap((design) =>
    CURSOR_SCREENS.map((screen) => {
      const file = path.join(directory, cursorFileName(design.name, screen));
      writeFileSync(file, encodePng(paintCursor(design, CURSOR_SCALE * screen.devicePixelsPerCssPixel)));
      return file;
    }),
  );
}

const DEFAULT_OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/cursors');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0 && !process.argv[outFlag + 1]) throw new Error('--out needs a directory; without the flag the cursors go to public/cursors');
  const directory = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : DEFAULT_OUTPUT_DIR;
  for (const file of writeCursors(directory)) console.log(`wrote ${file}`);
}
