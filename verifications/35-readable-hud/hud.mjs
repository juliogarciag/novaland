/* global window */
/** Helpers shared by the browser verifications of #35: reading the HUD off the page, measuring its pixels in a screenshot, and a TCP proxy that delays traffic. */
import net from 'node:net';
import { PNG } from 'pngjs';

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

/** The HUD text object as the page has it: its lines, its box in canvas (device) pixels and its style. */
export function hudOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const text = api.game.scene.getScene('hud').children.list.find((object) => object.type === 'Text');
    const bounds = text.getBounds();
    return {
      lines: text.text.split('\n'),
      box: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      padding: { left: text.padding.left, top: text.padding.top, right: text.padding.right, bottom: text.padding.bottom },
      color: text.style.color,
      backgroundColor: text.style.backgroundColor,
      pixelRatio: window.devicePixelRatio,
      canvas: { width: api.game.canvas.width, height: api.game.canvas.height },
    };
  });
}

/** Waits until the HUD's first line matches `pattern` and returns the HUD. */
export async function waitForHud(page, pattern, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let hud;
  while (Date.now() < deadline) {
    hud = await hudOf(page).catch(() => undefined);
    if (hud && pattern.test(hud.lines[0])) return hud;
    await page.waitForTimeout(50);
  }
  throw new Error(`HUD never matched ${pattern}: ${JSON.stringify(hud?.lines)}`);
}

/** The whole numbers the HUD's first line shows: `{ fps, latency }`, each undefined when absent or `--`. */
export function hudNumbers(hud) {
  const number = (pattern) => {
    const match = pattern.exec(hud.lines[0]);
    return match && match[1] !== '--' ? Number(match[1]) : undefined;
  };
  return { fps: number(/fps (\d+|--)/), latency: number(/latency (\d+|--) ms/) };
}

/** Which tiles lie under the HUD box, by def name, sampled every few pixels through the world camera. */
export function tilesUnderHud(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const text = api.game.scene.getScene('hud').children.list.find((object) => object.type === 'Text');
    const bounds = text.getBounds();
    const camera = api.camera();
    const counts = {};
    for (let screenY = bounds.y; screenY <= bounds.bottom; screenY += 3) {
      for (let screenX = bounds.x; screenX <= bounds.right; screenX += 3) {
        const x = (camera.worldView.x + screenX / camera.zoom) / api.pixelsPerMetre;
        const y = (camera.worldView.y + screenY / camera.zoom) / api.pixelsPerMetre;
        const tile = api.tileAt(api.grid, x, y);
        const name = tile ? api.defs.find((def) => def.id === api.grid.defIds[tile.row][tile.column]).name : 'outside';
        counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    return counts;
  });
}

/** Where the local player stands, in metres. */
export function playerPosition(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const own = api.snapshot().entities.find((entity) => entity.components.Player && entity.components.Player.slot === api.localSlot());
    return own ? { x: own.components.Position.x, y: own.components.Position.y } : undefined;
  });
}

/**
 * Walks the local player along one axis until its coordinate reaches
 * `target` (or it stops moving), through the same command path as the
 * keyboard, stopping in the page so it does not overshoot.
 */
export function walkTo(page, { axis, target }) {
  return page.evaluate(
    ({ axis, target }) =>
      new Promise((resolve) => {
        const api = window.__novaland;
        const slot = api.localSlot();
        const coordinate = () => api.snapshot().entities.find((entity) => entity.components.Player && entity.components.Player.slot === slot).components.Position[axis];
        const direction = Math.sign(target - coordinate());
        if (direction === 0) return resolve(coordinate());
        api.queueCommand({ type: 'player/move', slot, x: axis === 'x' ? direction : 0, y: axis === 'y' ? direction : 0 });
        const startedAt = performance.now();
        const timer = setInterval(() => {
          const reached = (target - coordinate()) * direction <= 0;
          if (!reached && performance.now() - startedAt < 15000) return;
          clearInterval(timer);
          api.queueCommand({ type: 'player/move', slot, x: 0, y: 0 });
          setTimeout(() => resolve(coordinate()), 150);
        }, 4);
      }),
    { axis, target },
  );
}

const channel = (value) => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance of an [r, g, b] colour. */
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG contrast ratio of two [r, g, b] colours. */
export const contrast = (one, other) => {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
export const parseHexColor = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

/**
 * Measures the HUD in a screenshot taken at the page's pixel ratio (so
 * screenshot pixels are canvas pixels). The ring is the band of backdrop
 * between the box edge and the text, where no glyph is; the surroundings are
 * the strip of world just outside the box.
 */
export function measureHudPixels(screenshot, hud) {
  const png = PNG.sync.read(screenshot);
  const pixel = (x, y) => {
    const offset = (png.width * y + x) * 4;
    return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
  };
  const box = { left: Math.round(hud.box.x), top: Math.round(hud.box.y), right: Math.round(hud.box.x + hud.box.width), bottom: Math.round(hud.box.y + hud.box.height) };
  const ringWidth = Math.max(2, Math.floor(Math.min(hud.padding.left, hud.padding.top) / 2));
  const textColor = parseHexColor(hud.color);
  const ring = [];
  const surroundings = [];
  let textPixels = 0;
  const textExtent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  // One pixel in from the edge: the outermost row may be blended with the world by the scaler.
  for (let y = box.top + 1; y < box.bottom - 1; y += 1) {
    for (let x = box.left + 1; x < box.right - 1; x += 1) {
      const color = pixel(x, y);
      const edgeDistance = Math.min(x - box.left, y - box.top, box.right - 1 - x, box.bottom - 1 - y);
      if (edgeDistance < ringWidth) ring.push(color);
      // A glyph pixel: far brighter than any backdrop can be.
      if (contrast(color, textColor) < 1.6) {
        textPixels += 1;
        textExtent.left = Math.min(textExtent.left, x - box.left);
        textExtent.top = Math.min(textExtent.top, y - box.top);
        textExtent.right = Math.max(textExtent.right, x - box.left);
        textExtent.bottom = Math.max(textExtent.bottom, y - box.top);
      }
    }
  }
  const gap = 3;
  const reach = 9;
  for (let y = Math.max(0, box.top - reach); y < Math.min(png.height, box.bottom + reach); y += 1) {
    for (let x = Math.max(0, box.left - reach); x < Math.min(png.width, box.right + reach); x += 1) {
      const outsideBy = Math.max(box.left - x, x - (box.right - 1), box.top - y, y - (box.bottom - 1));
      if (outsideBy >= gap) surroundings.push(pixel(x, y));
    }
  }
  const mean = (colors) => [0, 1, 2].map((index) => Math.round(colors.reduce((sum, color) => sum + color[index], 0) / colors.length));
  const lightestRing = ring.reduce((lightest, color) => (luminance(color) > luminance(lightest) ? color : lightest));
  return {
    box,
    ringPixels: ring.length,
    ringMean: mean(ring),
    lightestRing,
    surroundingsMean: mean(surroundings),
    textPixels,
    textExtent,
    /** Worst case: the text colour against the lightest backdrop pixel anywhere in the ring. */
    contrast: Number(contrast(textColor, lightestRing).toFixed(2)),
    /** What the same text would have without a backdrop, against the world next to the box. */
    contrastWithoutBackdrop: Number(contrast(textColor, mean(surroundings)).toFixed(2)),
  };
}

/**
 * A TCP proxy in front of `targetPort` that delivers every chunk `delayMs`
 * late in each direction, in order, so a round trip through it takes
 * 2 x delayMs longer; `hold()` keeps everything back until `release()`.
 */
export function startDelayProxy({ listenPort, targetPort }) {
  const state = { delayMs: 0, held: false };
  const flushers = new Set();
  const sockets = new Set();
  const pipe = (from, to) => {
    const queue = [];
    let lastReleaseAt = 0;
    let timer;
    const flush = () => {
      clearTimeout(timer);
      if (state.held) return;
      while (queue.length > 0 && queue[0].releaseAt <= Date.now()) {
        const { chunk } = queue.shift();
        if (chunk === null) to.end();
        else if (!to.destroyed) to.write(chunk);
      }
      if (queue.length > 0) timer = setTimeout(flush, Math.max(1, queue[0].releaseAt - Date.now()));
      else if (from.destroyed) flushers.delete(flush);
    };
    const enqueue = (chunk) => {
      lastReleaseAt = Math.max(lastReleaseAt, Date.now() + state.delayMs);
      queue.push({ chunk, releaseAt: lastReleaseAt });
      flush();
    };
    flushers.add(flush);
    from.on('data', enqueue);
    from.on('end', () => enqueue(null));
    from.on('error', () => to.destroy());
    from.on('close', () => flush());
  };
  const server = net.createServer((client) => {
    const upstream = net.connect({ port: targetPort, host: 'localhost' });
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true);
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    pipe(client, upstream);
    pipe(upstream, client);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () =>
      resolve({
        setDelay(delayMs) {
          state.delayMs = delayMs;
        },
        hold() {
          state.held = true;
        },
        release() {
          state.held = false;
          for (const flush of flushers) flush();
        },
        stop() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done) => server.close(done));
        },
      }),
    );
  });
}
