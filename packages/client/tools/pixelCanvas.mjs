/**
 * The pixel canvas the terrain sheet generators paint on: RGBA bytes, row by
 * row, with the few operations pixel art needs. Plain Node, no dependencies.
 */

/** A transparent canvas of this size in pixels. */
export function createCanvas(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Sets one pixel. Painting outside the canvas is a bug in the art, so it throws. */
export function pixel(canvas, x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error(`pixel (${x}, ${y}) is outside the ${canvas.width}x${canvas.height} frame`);
  canvas.data.set([r, g, b, alpha], (y * canvas.width + x) * 4);
}

/** Whether this pixel is fully opaque. Pixels outside the canvas are not. */
export function isOpaque(canvas, x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  return canvas.data[(y * canvas.width + x) * 4 + 3] === 255;
}

/** Paints every transparent pixel that touches the figure, giving it a one-pixel dark edge. */
export function outline(canvas, color) {
  const edge = [];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (isOpaque(canvas, x, y)) continue;
      if (isOpaque(canvas, x - 1, y) || isOpaque(canvas, x + 1, y) || isOpaque(canvas, x, y - 1) || isOpaque(canvas, x, y + 1)) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) pixel(canvas, x, y, color);
}

/** Copies all of `source` into `target` with its top-left corner at (atX, atY). */
export function blit(target, source, atX, atY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceRow = y * source.width * 4;
    const targetRow = ((atY + y) * target.width + atX) * 4;
    target.data.set(source.data.subarray(sourceRow, sourceRow + source.width * 4), targetRow);
  }
}

/** Copies the opaque pixels of `source` over `target`, both the same size. */
export function blitOpaque(target, source) {
  for (let offset = 0; offset < source.data.length; offset += 4) {
    if (source.data[offset + 3] === 255) target.data.set(source.data.subarray(offset, offset + 4), offset);
  }
}

/** A repeatable value in [0, 1) for a pixel: an integer hash, so a sheet is the same on every run. */
export function noise(x, y, seed) {
  let hash = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
