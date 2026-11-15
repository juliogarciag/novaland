/* global window */
/**
 * What the browser scripts share: starting the servers, opening the game,
 * walking the player with the keyboard, and comparing the minimap's pixels
 * on screen with the world's own data.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PROOF, ROOT, lastLinesOf, start, waitFor, waitForPort } from './lib.mjs';

/** Starts `PORT=<n> pnpm dev` and waits for its ready line. Throws with the server's last lines when it does not come up. */
export async function startClient({ port, env = {} }) {
  const devServer = start('pnpm', ['dev'], { env: { PORT: String(port), ...env } });
  const ready = (await waitForPort(port)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${port}/`), until: Boolean, timeoutMs: 20000 }).catch(() => false));
  if (!ready) throw new Error(`the dev server on ${port} did not start: ${lastLinesOf(devServer.output)}`);
  return devServer;
}

/** Starts the room server and waits for its boot line. */
export async function startRoomServer({ port }) {
  const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(port) } });
  const bootLine = (await waitForPort(port)) && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean, timeoutMs: 20000 }).catch(() => undefined));
  if (!bootLine) throw new Error(`the room server did not start: ${lastLinesOf(roomServer.output)}`);
  return roomServer;
}

/** A page of its own browser context (its own player online), open on the game with the local player drawn and the minimap showing. */
export async function openGame(browser, { port, viewport, pixelRatio = 1, online = false, errors = [], name = '' }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: pixelRatio });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}${error}`));
  page.on('console', (message) => message.type() === 'error' && errors.push(`${name}${message.text()}`));
  await page.goto(`http://localhost:${port}/`);
  if (online) await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 20000 });
  else await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__novaland.minimap()?.marks.some((mark) => mark.isLocalPlayer), null, { timeout: 20000 });
  return page;
}

/** Everything a check needs about one moment: the minimap's report, the local player as the sim has it, the camera and the HUD lines' box in CSS pixels. */
export function stateOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    const hud = api.game.scene.getScene('hud');
    const text = hud.children.list.find((child) => child.type === 'Text');
    const pixelRatio = 1 / api.game.scale.zoom;
    return {
      minimap: api.minimap(),
      player: player && { eid: player.eid ?? player.id, defId: player.components.DefRef.id, x: player.components.Position.x, y: player.components.Position.y },
      drawnAt: api.online?.localPlayerDrawnAt(),
      camera: api.camera(),
      window: { width: window.innerWidth, height: window.innerHeight, pixelRatio },
      hudLines: { x: text.x / pixelRatio, y: text.y / pixelRatio, width: text.width / pixelRatio, height: text.height / pixelRatio },
      spawn: api.tileCentre(api.map.spawn),
      bounds: api.tiles.bounds,
    };
  });
}

/** Holds a key the way a person does. */
export async function hold(page, key, milliseconds) {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
  await standStill(page);
}

/**
 * Walks until the local player is at least `metres` from where it started along one axis, stepping aside when
 * something solid is in the way (the generated map scatters trees and rocks). Returns the state at the end.
 */
export async function walk(page, { key, aside, metres }) {
  const axis = key === 'KeyD' || key === 'KeyA' ? 'x' : 'y';
  const from = (await stateOf(page)).player[axis];
  const deadline = Date.now() + 1000 * (metres / 2 + 10);
  await page.keyboard.down(key);
  let last = from;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const now = (await stateOf(page)).player[axis];
    if (Math.abs(now - from) >= metres) break;
    if (Math.abs(now - last) < 0.5) {
      await page.keyboard.down(aside);
      await page.waitForTimeout(400);
      await page.keyboard.up(aside);
    }
    last = now;
  }
  await page.keyboard.up(key);
  await standStill(page);
  return stateOf(page);
}

/** Waits until the local player has stopped and the minimap has drawn where it stopped. */
export async function standStill(page) {
  let last;
  await waitFor('the player to stand still', {
    read: async () => {
      const { minimap } = await stateOf(page);
      const still = last !== undefined && last.x === minimap.centre.x && last.y === minimap.centre.y;
      last = minimap.centre;
      return still;
    },
    until: Boolean,
    timeoutMs: 5000,
  });
}

/** The page as a PNG in device pixels, with a reader of one pixel by CSS coordinates. */
export async function pictureOf(page, pixelRatio = 1) {
  const png = PNG.sync.read(await page.screenshot());
  return {
    png,
    /** The colour of the device pixel that holds a CSS point, as 0xRRGGBB. */
    colorAt(x, y) {
      const index = (Math.floor(y * pixelRatio) * png.width + Math.floor(x * pixelRatio)) * 4;
      return (png.data[index] << 16) | (png.data[index + 1] << 8) | png.data[index + 2];
    },
  };
}

/** CSS pixels around a marker that its shape, rim and arrow may cover: no terrain is compared there. */
const MARKER_REACH = 16;

/**
 * Compares every tile the minimap shows with the world: the pixel in the
 * middle of the tile's square on screen must be the colour of the def the
 * map has at that tile, and where the map has no tile it must be the dark
 * backdrop. Tiles under a marker are skipped. The player must stand still.
 */
export async function terrainOnMinimap(page) {
  const { minimap, window: view } = await stateOf(page);
  const picture = await pictureOf(page, view.pixelRatio);
  const after = (await stateOf(page)).minimap;
  if (after.centre.x !== minimap.centre.x || after.centre.y !== minimap.centre.y) throw new Error('the minimap moved while it was compared');
  const tiles = await page.evaluate(() => {
    const api = window.__novaland;
    const { rect, worldOriginOnScreen: origin, cssPixelsPerTile } = api.minimap();
    const colorByDefId = new Map(api.defs.map((def) => [def.id, { color: def.color, name: def.name }]));
    const tiles = [];
    const firstColumn = Math.ceil((rect.x - origin.x) / cssPixelsPerTile);
    const firstRow = Math.ceil((rect.y - origin.y) / cssPixelsPerTile);
    for (let row = firstRow; origin.y + (row + 1) * cssPixelsPerTile <= rect.y + rect.height; row += 1) {
      for (let column = firstColumn; origin.x + (column + 1) * cssPixelsPerTile <= rect.x + rect.width; column += 1) {
        const defId = api.tileDefIdAt({ column, row });
        tiles.push({ column, row, ...(defId === undefined ? { name: null, color: null } : colorByDefId.get(defId)) });
      }
    }
    return tiles;
  });
  const result = { centre: minimap.centre, tilesCompared: 0, tilesUnderMarkers: 0, byKind: {}, wrong: [] };
  for (const tile of tiles) {
    const x = minimap.worldOriginOnScreen.x + (tile.column + 0.5) * minimap.cssPixelsPerTile;
    const y = minimap.worldOriginOnScreen.y + (tile.row + 0.5) * minimap.cssPixelsPerTile;
    if (minimap.marks.some((mark) => Math.hypot(mark.x - x, mark.y - y) < MARKER_REACH)) {
      result.tilesUnderMarkers += 1;
      continue;
    }
    const seen = picture.colorAt(x, y);
    const kind = tile.name ?? 'no tile';
    result.tilesCompared += 1;
    result.byKind[kind] = (result.byKind[kind] ?? 0) + 1;
    const right = tile.color === null ? isBackdrop(seen) : seen === tile.color;
    if (!right && result.wrong.length < 10) result.wrong.push({ ...tile, seen: hex(seen), expected: tile.color === null ? 'backdrop' : hex(tile.color) });
    if (!right) result.wrongCount = (result.wrongCount ?? 0) + 1;
  }
  result.wrongCount ??= 0;
  return result;
}

/** One line for a check's details. */
export function terrainSummary(result) {
  const kinds = Object.entries(result.byKind).map(([kind, count]) => `${count} ${kind}`).join(', ');
  return `${result.tilesCompared} tiles compared around (${result.centre.x.toFixed(1)}, ${result.centre.y.toFixed(1)}): ${kinds}; ${result.tilesUnderMarkers} under markers skipped; ${result.wrongCount} wrong${result.wrongCount ? ` ${JSON.stringify(result.wrong.slice(0, 3))}` : ''}`;
}

/** Saves the page, and the minimap alone four times larger so a person can read it. */
export async function saveProofPictures(page, name) {
  const { minimap, window: view } = await stateOf(page);
  const { png } = await pictureOf(page, view.pixelRatio);
  writeFileSync(path.join(PROOF, `${name}.png`), PNG.sync.write(png));
  const pad = 4;
  const left = Math.max(0, Math.floor((minimap.rect.x - pad) * view.pixelRatio));
  const top = Math.max(0, Math.floor((minimap.rect.y - pad) * view.pixelRatio));
  const width = Math.min(png.width - left, Math.ceil((minimap.rect.width + 2 * pad) * view.pixelRatio));
  const height = Math.min(png.height - top, Math.ceil((minimap.rect.height + 2 * pad) * view.pixelRatio));
  const scale = Math.max(1, Math.round(4 / view.pixelRatio));
  const closeUp = new PNG({ width: width * scale, height: height * scale });
  for (let y = 0; y < closeUp.height; y += 1) {
    for (let x = 0; x < closeUp.width; x += 1) {
      const from = ((top + Math.floor(y / scale)) * png.width + left + Math.floor(x / scale)) * 4;
      png.data.copy(closeUp.data, (y * closeUp.width + x) * 4, from, from + 4);
    }
  }
  writeFileSync(path.join(PROOF, `${name}-minimap.png`), PNG.sync.write(closeUp));
}

/** True when two rectangles `{ x, y, width, height }` share any area. */
export function overlap(first, second) {
  return first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
}

export function hex(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// ---- Helpers ----

/** The minimap's backdrop is near-black: no channel gets past this. Every tile colour has one that does. */
function isBackdrop(color) {
  return ((color >> 16) & 0xff) <= 64 && ((color >> 8) & 0xff) <= 64 && (color & 0xff) <= 64;
}
