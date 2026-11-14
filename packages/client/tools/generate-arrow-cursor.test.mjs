import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARROW_CURSOR_CSS_SIZE,
  ARROW_CURSOR_DESIGN_SIZE,
  ARROW_CURSOR_FILES,
  ARROW_CURSOR_HOTSPOT,
  ARROW_CURSOR_PALETTE,
  ARROW_CURSOR_ROWS,
  ARROW_CURSOR_SCALE,
  paintArrowCursor,
} from './generate-arrow-cursor.mjs';
import { encodePng } from './generate-player-sheet.mjs';

describe('arrow cursor generator', () => {
  it('paints every design pixel as one block of its palette colour, and nothing else', () => {
    for (const blockSize of [1, 2, 4]) {
      const canvas = paintArrowCursor(blockSize);
      expect([canvas.width, canvas.height]).toEqual([ARROW_CURSOR_DESIGN_SIZE * blockSize, ARROW_CURSOR_DESIGN_SIZE * blockSize]);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const character = ARROW_CURSOR_ROWS[Math.floor(y / blockSize)]?.[Math.floor(x / blockSize)];
          const expected = ARROW_CURSOR_PALETTE[character] ? [...ARROW_CURSOR_PALETTE[character], 255] : [0, 0, 0, 0];
          expect(rgbaAt(canvas, x, y), `block size ${blockSize}, pixel (${x}, ${y})`).toEqual(expected);
        }
      }
    }
  });

  it('has the tip of the arrow, in the outline colour, at the hotspot', () => {
    expect(ARROW_CURSOR_HOTSPOT).toEqual({ x: 0, y: 0 });
    expect(rgbaAt(paintArrowCursor(1), ARROW_CURSOR_HOTSPOT.x, ARROW_CURSOR_HOTSPOT.y)).toEqual([...ARROW_CURSOR_PALETTE.X, 255]);
  });

  it('is 32 CSS pixels on screen, inside the size browsers accept for a cursor', () => {
    expect(ARROW_CURSOR_CSS_SIZE).toBe(32);
  });

  it('matches the files committed under public/cursors, byte for byte', () => {
    for (const { name, devicePixelsPerCssPixel } of ARROW_CURSOR_FILES) {
      const committed = readFileSync(path.join(CLIENT, 'public/cursors', name));
      const painted = encodePng(paintArrowCursor(ARROW_CURSOR_SCALE * devicePixelsPerCssPixel));
      expect(Buffer.compare(committed, Buffer.from(painted)), `${name} is stale: run pnpm --filter @novaland/client art:cursor`).toBe(0);
    }
  });
});

describe('the cursor rule of index.html', () => {
  it('names every cursor file for its screen, clicks at the hotspot and falls back to the default pointer', () => {
    const declarations = cursorDeclarationsOf(readFileSync(path.join(CLIENT, 'index.html'), 'utf8'));
    const hotspot = `${ARROW_CURSOR_HOTSPOT.x * ARROW_CURSOR_SCALE} ${ARROW_CURSOR_HOTSPOT.y * ARROW_CURSOR_SCALE}`;
    const [ordinaryScreen] = ARROW_CURSOR_FILES;
    const perScreen = ARROW_CURSOR_FILES.map(({ name, devicePixelsPerCssPixel }) => `url('/cursors/${name}') ${devicePixelsPerCssPixel}x`).join(', ');
    expect(declarations).toEqual([`url('/cursors/${ordinaryScreen.name}') ${hotspot}, auto`, `image-set(${perScreen}) ${hotspot}, auto`]);
  });
});

// ---- Helpers ----

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rgbaAt(canvas, x, y) {
  const offset = (y * canvas.width + x) * 4;
  return [...canvas.data.subarray(offset, offset + 4)];
}

/** The values of the `cursor` declarations of the page's `html` rule, in order. */
function cursorDeclarationsOf(indexHtml) {
  const rule = /\n\s*html \{([^}]*)\}/.exec(indexHtml)?.[1] ?? '';
  return [...rule.matchAll(/cursor:\s*([^;]+);/g)].map((match) => match[1].trim());
}
