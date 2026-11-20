/* global window */
/**
 * #64 solo: the world drawn at 32 pixels per tile, at the scale it had at 16.
 *
 * Starts `PORT=<n> pnpm dev` and opens the client in Chromium at several
 * screen sizes. On each it reads the page through `window.__novaland` and
 * the world scene's own game objects, and checks what a player sees:
 *
 *   - every terrain sheet the page loaded is drawn at 32 pixels per metre,
 *     and the ground tileset that holds them fits in a texture;
 *   - the camera shows as many metres as the same rule did with 16-pixel
 *     art, so a metre takes as many device pixels on screen as before;
 *   - trees, rocks and the player stand as many metres tall and wide as
 *     before, and the player's 32x48 sheet is drawn at 1:1;
 *   - names keep their size on screen and sit just above the head;
 *   - the minimap still paints the terrain around the player.
 *
 * Then it walks the player east, points the camera at the nearest lake and
 * keeps screenshots of both.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const PORT = 5264;
/** What the world's art was drawn at before this ticket: the scale the camera has to keep. This and the other "before" numbers here are measured on the base commit by before-after.mjs. */
const PIXELS_PER_METRE_BEFORE = 16;
/**
 * Screens to open, in CSS pixels and device pixels per CSS pixel: 1x monitors
 * and 2x laptop panels from 1280 to 3840 device pixels across. 1440x900 and
 * 1512x982 at 2x are the two whose zoom was odd at 16 pixels per metre.
 */
const SCREENS = [
  { name: '1280x800', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: '1920x1080', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { name: '2560x1440', viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  { name: '1440x900@2x', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: '1512x982@2x', viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 },
  { name: '1728x1117@2x', viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 },
  // The worst case: a window 960 to 1279 px wide had zoom 3, now 1, and sees half as much world again.
  { name: '1024x768', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 },
];
/** The size the art stood in the world at 16 pixels per metre, in metres: frames of 24x32 (tree), 16x20 (rock) and 16x24 (player). What a player sees must not change. */
const METRES_BEFORE = { tree: { width: 1.5, height: 2 }, rock: { width: 1, height: 1.25 }, player: { width: 1, height: 1.5 } };
/** At 16 pixels per metre a pixel of a letter was this share of a pixel of the world (nameLabel.ts before #64), and the gap above the head one pixel. */
const LETTER_PIXEL_SHARE_BEFORE = 0.6;
const NAME_GAP_METRES_BEFORE = 1 / 16;
const CHARACTER = { name: 'Thirty-Two', look: { skin: 2, hair: 3, clothes: 1 } };

const results = [];
const report = { screens: {} };
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');
  browser = await chromium.launch();

  for (const screen of SCREENS) {
    const page = await openWorld(screen);
    const seen = await whatThePageDraws(page);
    report.screens[screen.name] = seen;
    if (screen === SCREENS[0]) checkArt(seen);
    checkScale(screen, seen);
    if (screen === SCREENS[0]) {
      await page.screenshot({ path: path.join(PROOF, 'solo-spawn-1280x800.png') });
      await walkEast(page);
      await showNearestLake(page);
    }
    if (screen.name === '1920x1080') await page.screenshot({ path: path.join(PROOF, 'solo-spawn-1920x1080.png') });
    await page.context().close();
  }
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('solo.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Checks ----

function checkArt(seen) {
  const { pixelsPerMetre, sheets, tileset } = seen;
  results.push(check('the client draws the world at 32 pixels per metre', pixelsPerMetre === 32, `${pixelsPerMetre}`));
  for (const sheet of sheets) {
    const declared = sheet.kind === 'ground' ? `${sheet.tilePixels}-pixel tiles` : `${sheet.frameWidth}x${sheet.frameHeight} frames at ${sheet.pixelsPerMetre} per metre`;
    const atThirtyTwo = sheet.kind === 'ground' ? sheet.tilePixels === pixelsPerMetre : sheet.pixelsPerMetre === pixelsPerMetre;
    const loadedAsDeclared =
      sheet.kind === 'ground'
        ? sheet.image.height === sheet.tilePixels && sheet.image.width % sheet.tilePixels === 0 && sheet.image.width / sheet.tilePixels >= sheet.variantCount
        : sheet.image.width === sheet.frameWidth * sheet.variantCount && sheet.image.height === sheet.frameHeight;
    results.push(check(`the ${sheet.key} sheet is art at 32 pixels per metre, loaded at the size its def declares`, atThirtyTwo && loadedAsDeclared, `${declared}; image ${sheet.image.width}x${sheet.image.height}`));
  }
  const tilesetFits = tileset && tileset.width <= 4096 && tileset.height <= 4096 && (tileset.width / tileset.tilePixels) * (tileset.height / tileset.tilePixels) >= tileset.tileCount;
  results.push(check('the ground tileset holds every ground tile in a texture no side of which passes 4096 pixels', Boolean(tilesetFits), tileset && `${tileset.width}x${tileset.height} for ${tileset.tileCount} tiles of ${tileset.tilePixels}`));
}

function checkScale(screen, seen) {
  const { camera, pixelsPerMetre, minVisibleMetres, drawn, names, minimap } = seen;
  const zoomBefore = Math.max(1, Math.floor(camera.width / (PIXELS_PER_METRE_BEFORE * minVisibleMetres)));
  const devicePixelsPerMetre = camera.zoom * pixelsPerMetre;
  const devicePixelsPerMetreBefore = zoomBefore * PIXELS_PER_METRE_BEFORE;
  const extraWorld = devicePixelsPerMetreBefore / devicePixelsPerMetre;
  // Where the zoom at 16 was even it halves exactly; where it was odd, 2k + 1, it rounds down to k: (2k + 1) / 2k times the world.
  const expectedExtraWorld = zoomBefore % 2 === 0 ? 1 : zoomBefore / (zoomBefore - 1);
  results.push(
    check(
      `${screen.name}: a whole zoom showing at least ${minVisibleMetres} m: the world it showed at 16 px per metre, or (2k + 1) / 2k of it where that zoom was odd`,
      Number.isInteger(camera.zoom) && camera.visibleMetres.width >= minVisibleMetres && close(extraWorld, expectedExtraWorld),
      `${camera.width} device px: zoom ${camera.zoom} (${zoomBefore} before), ${devicePixelsPerMetre} device px per metre (${devicePixelsPerMetreBefore} before), ${camera.visibleMetres.width.toFixed(1)} m across, ${extraWorld}x the world`,
    ),
  );
  for (const thing of ['tree', 'rock', 'player']) {
    const size = drawn[thing];
    const expected = METRES_BEFORE[thing];
    const same = size && close(size.width, expected.width) && close(size.height, expected.height);
    const atOneToOne = thing !== 'player' || size?.scale === 1;
    results.push(check(`${screen.name}: ${thing}s stand ${expected.width} x ${expected.height} m, as before${thing === 'player' ? ', the sheet at 1:1' : ''}`, Boolean(same) && atOneToOne, size && `${size.width} x ${size.height} m, ${size.count} drawn${size.scale ? `, sheet scaled ${size.scale}x` : ''}`));
  }
  const name = names[0];
  const letterPixelBefore = Math.max(1, Math.round(zoomBefore * LETTER_PIXEL_SHARE_BEFORE));
  // A name is sized against the world: where a metre takes the device pixels it took before, so does a letter; where the world draws smaller (an odd zoom before), the name draws smaller with it.
  const letterPixelExpected = Math.max(1, Math.round((devicePixelsPerMetre / PIXELS_PER_METRE_BEFORE) * LETTER_PIXEL_SHARE_BEFORE));
  results.push(
    check(
      `${screen.name}: the name is lettered as big against the world as before and sits ${NAME_GAP_METRES_BEFORE} m above the head`,
      Boolean(name) && name.devicePixelsPerLetterPixel === letterPixelExpected && close(name.gapMetres, NAME_GAP_METRES_BEFORE) && close(name.x, name.headX),
      name && `letter pixel ${name.devicePixelsPerLetterPixel} device px (${letterPixelExpected} expected, ${letterPixelBefore} before), ${name.devicePixelsTall} device px tall, gap ${name.gapMetres} m`,
    ),
  );
  results.push(check(`${screen.name}: the minimap paints the terrain around the player`, Boolean(minimap) && minimap.chunksDrawn.length > 0 && minimap.marks.length > 0, minimap && `${minimap.chunksDrawn.length} chunks, ${minimap.marks.length} marks, ${minimap.rect.width}x${minimap.rect.height} css px`));
}

// ---- Helpers ----

async function openWorld(screen) {
  const context = await browser.newContext({ viewport: screen.viewport, deviceScaleFactor: screen.deviceScaleFactor });
  await rememberCharacter(context, CHARACTER);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${screen.name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${screen.name}: ${message.text()}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.drawnNames().length > 0 && window.__novaland.minimap()?.chunksDrawn.length > 0, null, { timeout: 20000 });
  return page;
}

/** Everything the checks read, from the debug API and the world scene's game objects, in metres where the world has them. */
function whatThePageDraws(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const ppm = api.pixelsPerMetre;
    const scene = api.game.scene.getScene('world');
    const camera = api.camera();
    const textures = api.game.textures;
    const sheets = api.defs.flatMap((def) => {
      const ground = def.groundSprite && { kind: 'ground', ...def.groundSprite };
      const standing = def.standingSprite && { kind: 'standing', ...def.standingSprite };
      return [ground, standing].filter(Boolean).map((sheet) => {
        const image = textures.exists(sheet.key) ? textures.get(sheet.key).getSourceImage() : { width: 0, height: 0 };
        return { ...sheet, image: { width: image.width, height: image.height } };
      });
    });
    const tilesetTexture = textures.exists('terrain-ground-tiles') ? textures.get('terrain-ground-tiles') : undefined;
    const groundTilePixels = sheets.find((sheet) => sheet.kind === 'ground')?.tilePixels;
    const tileset = tilesetTexture && {
      width: tilesetTexture.getSourceImage().width,
      height: tilesetTexture.getSourceImage().height,
      tilePixels: groundTilePixels,
      tileCount: api.defs.filter((def) => def.solid !== undefined).reduce((count, def) => {
        const sheet = sheets.find((candidate) => candidate.kind === 'ground' && candidate.key === def.groundSprite?.key);
        return count + (sheet ? sheet.image.width / sheet.tilePixels : 1);
      }, 0),
    };
    const objects = scene.children.list;
    const sizeOf = (matching) => {
      const found = objects.filter(matching);
      if (found.length === 0) return undefined;
      const first = found[0];
      return { width: first.displayWidth / ppm, height: first.displayHeight / ppm, scale: first.scaleX, count: found.length };
    };
    const names = api.drawnNames();
    const playerTextureKeys = new Set(names.map((name) => name.textureKey));
    const drawn = {
      tree: sizeOf((object) => object.type === 'Image' && object.texture.key === 'tree'),
      rock: sizeOf((object) => object.type === 'Image' && object.texture.key === 'rock'),
      player: sizeOf((object) => object.type === 'Sprite' && playerTextureKeys.has(object.texture.key)),
    };
    const labels = objects.filter((object) => object.type === 'Text');
    const sprites = objects.filter((object) => object.type === 'Sprite' && playerTextureKeys.has(object.texture.key));
    const nameReports = names.map((name) => {
      const label = labels.find((candidate) => candidate.text === name.name && candidate.x === name.x && candidate.y === name.y);
      const sprite = sprites.find((candidate) => candidate.x === name.x) ?? sprites[0];
      const headY = sprite.y - sprite.displayHeight * sprite.originY;
      return {
        name: name.name,
        x: name.x,
        headX: sprite.x,
        gapMetres: (headY - name.y) / ppm,
        // The label is rendered at `fontSize` device pixels and scaled back by the zoom (nameLabel.ts): 8 is the font's grid.
        devicePixelsPerLetterPixel: label ? parseFloat(label.style.fontSize) / 8 : undefined,
        devicePixelsTall: label ? Math.round(label.displayHeight * camera.zoom) : undefined,
      };
    });
    return { pixelsPerMetre: ppm, minVisibleMetres: api.minVisibleMetres, camera, sheets, tileset, drawn, names: nameReports, minimap: api.minimap(), terrain: api.terrain() };
  });
}

function close(value, expected) {
  return Math.abs(value - expected) < 1e-6;
}

/** Holds D for a second: the player walks east, the view follows, and a screenshot keeps it. */
async function walkEast(page) {
  const before = await page.evaluate(() => window.__novaland.drawnNames()[0]);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  const after = await page.evaluate(() => window.__novaland.drawnNames()[0]);
  results.push(check('holding D walks the player east and its name goes with it', after.x > before.x && after.y === before.y, `name from x ${before.x} to ${after.x} world px`));
  await page.screenshot({ path: path.join(PROOF, 'solo-walked-east-1280x800.png') });
}

/**
 * Points the world camera at the water tile nearest the spawn and keeps a
 * screenshot. The world scene centres the camera on the player every frame,
 * so this replaces that one call on the scene object for the rest of the
 * page's life: it moves the view only, never the sim.
 */
async function showNearestLake(page) {
  const lake = await page.evaluate(() => {
    const api = window.__novaland;
    const water = api.defs.find((def) => def.name === 'water').id;
    const spawn = api.map.spawn;
    for (let radius = 0; radius < 200; radius += 1) {
      for (let column = spawn.column - radius; column <= spawn.column + radius; column += 1) {
        for (const row of [spawn.row - radius, spawn.row + radius]) {
          if (api.tileDefIdAt({ column, row }) === water) return { column, row };
        }
      }
      for (let row = spawn.row - radius; row <= spawn.row + radius; row += 1) {
        for (const column of [spawn.column - radius, spawn.column + radius]) {
          if (api.tileDefIdAt({ column, row }) === water) return { column, row };
        }
      }
    }
    return undefined;
  });
  if (!lake) {
    results.push(check('there is a lake to look at', false));
    return;
  }
  await page.evaluate((tile) => {
    const api = window.__novaland;
    const scene = api.game.scene.getScene('world');
    const centre = api.tileCentre(tile);
    scene.followLocalPlayer = function lookAtLake() {
      this.mapCamera.lookAt(centre.x * api.pixelsPerMetre, centre.y * api.pixelsPerMetre);
      this.terrainRenderer.show(this.mapCamera.view());
    };
  }, lake);
  const shown = await waitFor('the lake chunk drawn', {
    read: () => page.evaluate((tile) => ({ terrain: window.__novaland.terrain(), chunk: `${Math.floor(tile.column / window.__novaland.chunkSize)},${Math.floor(tile.row / window.__novaland.chunkSize)}` }), lake),
    until: ({ terrain, chunk }) => terrain.chunksDrawn.includes(chunk),
  }).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(PROOF, 'solo-lake-1280x800.png') });
  results.push(check('the nearest lake is drawn in the ground, coast and all', Boolean(shown), `water tile ${lake.column},${lake.row}`));
}
