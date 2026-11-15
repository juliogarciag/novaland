import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CURSOR_CSS_SIZE, CURSOR_DESIGNS, CURSOR_DESIGN_SIZE, CURSOR_SCALE, CURSOR_SCREENS, cursorFileName, paintCursor } from './generate-cursors.mjs';

describe('cursor generator', () => {
  it('paints every design pixel as one block of its palette colour, and nothing else', () => {
    for (const design of CURSOR_DESIGNS) {
      for (const blockSize of [1, 2, 4]) {
        const canvas = paintCursor(design, blockSize);
        expect([canvas.width, canvas.height]).toEqual([CURSOR_DESIGN_SIZE * blockSize, CURSOR_DESIGN_SIZE * blockSize]);
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const expected = designRgbaAt(design, Math.floor(x / blockSize), Math.floor(y / blockSize));
            expect(rgbaAt(canvas, x, y), `${design.name}, block size ${blockSize}, pixel (${x}, ${y})`).toEqual(expected);
          }
        }
      }
    }
  });

  it('gives every design a tip to click with: an opaque pixel at its hotspot', () => {
    for (const design of CURSOR_DESIGNS) expect(designRgbaAt(design, design.hotspot.x, design.hotspot.y)[3], design.name).toBe(255);
  });

  it('keeps every cursor within the 32 CSS pixels a browser shows without falling back to its own pointer', () => {
    expect(CURSOR_CSS_SIZE).toBeLessThanOrEqual(32);
  });

  it('holds the same pixels as the files committed under public/cursors', () => {
    for (const design of CURSOR_DESIGNS) {
      for (const screen of CURSOR_SCREENS) {
        const name = cursorFileName(design.name, screen);
        const committed = decodedPng(readFileSync(path.join(CLIENT, 'public/cursors', name)));
        const painted = paintCursor(design, CURSOR_SCALE * screen.devicePixelsPerCssPixel);
        expect([committed.width, committed.height], name).toEqual([painted.width, painted.height]);
        expect(Buffer.compare(committed.data, Buffer.from(painted.data)), `${name} is stale: run pnpm --filter @novaland/client art:cursors`).toBe(0);
      }
    }
  });
});

describe('the cursor index.html shows', () => {
  it('is the arrow of the generator: its file for each screen, clicking at its hotspot in CSS pixels, with auto as the fallback', () => {
    const rule = /\n\s*html \{([^}]*)\}/.exec(readFileSync(path.join(CLIENT, 'index.html'), 'utf8'));
    expect(rule, 'the html rule of index.html, where the cursor is set').not.toBeNull();
    const declarations = [...rule[1].matchAll(/cursor:\s*([^;]+);/g)].map((match) => match[1].trim());
    const [design] = CURSOR_DESIGNS;
    const [ordinaryScreen] = CURSOR_SCREENS;
    const click = `${design.hotspot.x * CURSOR_SCALE} ${design.hotspot.y * CURSOR_SCALE}`;
    const perScreen = CURSOR_SCREENS.map((screen) => `url('/cursors/${cursorFileName(design.name, screen)}') ${screen.devicePixelsPerCssPixel}x`).join(', ');
    expect(declarations).toEqual([`url('/cursors/${cursorFileName(design.name, ordinaryScreen)}') ${click}, auto`, `image-set(${perScreen}) ${click}, auto`]);
  });
});

// ---- Helpers ----

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rgbaAt(canvas, x, y) {
  const offset = (y * canvas.width + x) * 4;
  return [...canvas.data.subarray(offset, offset + 4)];
}

/** The colour the design gives a design pixel, as [red, green, blue, alpha]; transparent where it names none. */
function designRgbaAt(design, x, y) {
  const color = design.palette[design.rows[y]?.[x]];
  if (!color) return [0, 0, 0, 0];
  return [...color, 255];
}

/** The size and RGBA bytes of a PNG as the generators write them: 8-bit RGBA, no row filter, not interlaced. */
function decodedPng(file) {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const compressed = [];
  for (let offset = 8; offset < file.length; ) {
    const length = file.readUInt32BE(offset);
    if (file.toString('latin1', offset + 4, offset + 8) === 'IDAT') compressed.push(file.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    if (filtered[y * (stride + 1)] !== 0) throw new Error(`row ${y} uses a filter; the generators write none`);
    filtered.copy(data, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, data };
}
