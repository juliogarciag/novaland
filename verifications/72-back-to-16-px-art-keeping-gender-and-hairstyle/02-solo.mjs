/* global window, document, Image */
/**
 * Solo, in the real client (`PORT=<n> pnpm dev` from this worktree):
 *
 * 1. Side by side with `c466e78` (the copy the main session runs on
 *    BEFORE_32_PX_URL): the same character at the same window size gets the
 *    same pixels per metre, the same zoom and the same metres on screen, and
 *    the middle of the screen (the player, its name and the ground round it)
 *    is drawn pixel for pixel the same. The character is one a browser
 *    remembered before genders and hairstyles existed, so this also proves
 *    such a character still loads.
 * 2. Every gender with every hairstyle, in all four directions: the texture
 *    the renderer built for the look, the idle frame the sprite shows after
 *    the player turns, and crops of the screen as proof.
 * 3. The creator: the 16x24 preview at its old scale, gender and hairstyle
 *    pickers with the suggested hairstyle, the turning keys, and the character
 *    it saves reaching the world.
 * 4. A character saved by the 32 px version (all five indexes) goes straight
 *    into the world with its look.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** A port no other session uses, and not the 5172 of the dev server left running for the human. */
const PORT = 5973;
/** The copy of main at c466e78 the main session runs. This script only reads it. */
const BEFORE_32_PX_URL = 'http://localhost:5150/';
const VIEWPORT = { width: 960, height: 720 };
const DIRECTIONS = [
  ['down', 'KeyS'],
  ['up', 'KeyW'],
  ['left', 'KeyA'],
  ['right', 'KeyD'],
];
/** The order the looks turn in: a player spawns facing down, so down comes last and every turn is a real one. */
const TURN_ORDER = ['up', 'left', 'right', 'down'].map((direction) => DIRECTIONS.find(([name]) => name === direction));
const LOOKS = [
  { label: 'male, short', gender: 0, hairStyle: 0 },
  { label: 'male, long', gender: 0, hairStyle: 1 },
  { label: 'female, short', gender: 1, hairStyle: 0 },
  { label: 'female, long', gender: 1, hairStyle: 1 },
];
/** Seen from behind there is no face, so the genders look alike; from any other side every look differs. */
const DISTINCT_LOOKS_FACING = { down: 4, up: 2, left: 4, right: 4 };
const results = [];
const report = {};
const pageErrors = [];
const generator = await import(path.join(ROOT, 'packages/client/tools/generate-player-sheet.mjs'));

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');
  browser = await chromium.launch();

  await sideBySide();
  await everyLookInEveryDirection();
  await creator();
  await savedBy32PixelVersion();

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('02-solo.json', report);
process.exit(summarize(results) ? 0 : 1);

async function sideBySide() {
  // A character as a browser remembered it before #66: three colour indexes, no gender, no hairstyle.
  const character = { name: 'Ada', look: { skin: 2, hair: 0, clothes: 0 } };
  const before = await openPlaying(BEFORE_32_PX_URL, character, { label: 'c466e78' }).catch((error) => {
    throw new Error(`the copy of c466e78 at ${BEFORE_32_PX_URL} did not open: ${error.message}`);
  });
  const now = await openPlaying(`http://localhost:${PORT}/`, character, { label: 'now' });
  const [viewBefore, viewNow] = await Promise.all([viewOf(before), viewOf(now)]);
  report.sideBySide = { before: viewBefore, now: viewNow };
  results.push(check('16 pixels per metre, as at c466e78', viewNow.pixelsPerMetre === 16 && viewNow.pixelsPerMetre === viewBefore.pixelsPerMetre, `${viewBefore.pixelsPerMetre} then, ${viewNow.pixelsPerMetre} now`));
  results.push(check('the same zoom and the same metres on screen as c466e78', viewNow.zoom === viewBefore.zoom && JSON.stringify(viewNow.visibleMetres) === JSON.stringify(viewBefore.visibleMetres), `zoom ${viewBefore.zoom} / ${viewNow.zoom}, ${JSON.stringify(viewNow.visibleMetres)}`));
  results.push(check('a character remembered before genders and hairstyles plays as the first of each', viewNow.look?.gender === 0 && viewNow.look?.hairStyle === 0, JSON.stringify(viewNow.look)));
  const pictures = { before: await before.screenshot(), now: await now.screenshot() };
  writeFileSync(path.join(PROOF, '02-c466e78.png'), pictures.before);
  writeFileSync(path.join(PROOF, '02-now.png'), pictures.now);
  // The middle of the screen: the player, its name and the ground round it, clear of the HUD in the corners.
  const middle = { x: VIEWPORT.width / 2 - 160, y: VIEWPORT.height / 2 - 120, width: 320, height: 240 };
  const comparison = await compareAndJoin(now, pictures, middle);
  writeFileSync(path.join(PROOF, '02-side-by-side.png'), Buffer.from(comparison.joined, 'base64'));
  report.sideBySide.middle = { ...middle, differingPixels: comparison.differing, wholeScreenDifferingPixels: comparison.differingWhole };
  results.push(check('the middle of the screen is drawn pixel for pixel as at c466e78', comparison.differing === 0, `${comparison.differing} of ${middle.width * middle.height} differ (whole screen: ${comparison.differingWhole}, HUD text included)`));
  await before.context().close();
  await now.context().close();
}

async function everyLookInEveryDirection() {
  report.looks = [];
  const framesByDirection = Object.fromEntries(DIRECTIONS.map(([direction]) => [direction, []]));
  const crops = [];
  for (const look of LOOKS) {
    const character = { name: look.label, look: { skin: 2, hair: 0, clothes: 0, gender: look.gender, hairStyle: look.hairStyle } };
    const page = await openPlaying(`http://localhost:${PORT}/`, character, { label: look.label });
    const lookKey = `2-0-0-${look.gender}-${look.hairStyle}`;
    const entry = { look: look.label, directions: {} };
    const palettes = await page.evaluate(() => window.__novaland.characterPalettes);
    const painted = generator.paintPlayerSheet({ gender: ['male', 'female'][look.gender], hairstyle: ['short', 'long'][look.hairStyle] });
    for (const [direction, key] of TURN_ORDER) {
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
      const shown = await waitFor(`${look.label} idles facing ${direction}`, { read: () => spriteOf(page), until: (sprite) => sprite && sprite.frame === sprite.idleFrames[direction] }).catch(() => spriteOf(page));
      const texture = await textureFrameOf(page, shown.textureKey, shown.idleFrames[direction]);
      framesByDirection[direction].push(texture.pixels);
      entry.directions[direction] = { textureKey: shown.textureKey, frame: shown.frame, idleFrame: shown.idleFrames[direction], frameSize: texture.size };
      results.push(check(`${look.label} facing ${direction}: drawn from its own look's texture, idle frame of that direction, 16x24`, shown.textureKey === `player/look/${lookKey}` && shown.frame === shown.idleFrames[direction] && texture.size === '16x24', `${shown.textureKey} frame ${shown.frame}`));
      const expected = recolouredFrame(painted, shown.idleFrames[direction], { skin: palettes.skin[2].color, hair: palettes.hair[0].color, clothes: palettes.clothes[0].color });
      results.push(check(`${look.label} facing ${direction}: the texture the client built is the generator's figure for that pair, pixel for pixel`, texture.pixels === expected));
      crops.push(await page.screenshot({ clip: await playerClip(page) }));
    }
    report.looks.push(entry);
    await page.context().close();
  }
  for (const [direction] of DIRECTIONS) {
    const distinct = new Set(framesByDirection[direction]).size;
    results.push(check(`facing ${direction}, the four looks are ${DISTINCT_LOOKS_FACING[direction]} different figures`, distinct === DISTINCT_LOOKS_FACING[direction], `${distinct} distinct`));
  }
  const grid = await joinGrid(crops, { columns: TURN_ORDER.length, scale: 3 });
  writeFileSync(path.join(PROOF, '02-every-look-every-direction.png'), Buffer.from(grid, 'base64'));
}

async function creator() {
  const context = await newContext();
  const page = await context.newPage();
  watchErrors(page, 'creator');
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#creator[data-screen="creator"]');
  const preview = await page.$eval('#creator canvas.creator-preview', (canvas) => ({ width: canvas.width, height: canvas.height }));
  results.push(check('the creator previews the 16x24 frame at 6x, as at c466e78', preview.width === 96 && preview.height === 144, `${preview.width}x${preview.height}`));
  const pickers = await page.$$eval('#creator fieldset legend', (legends) => legends.map((legend) => legend.textContent));
  results.push(check('the creator offers gender and hairstyle', pickers.some((text) => /gender/i.test(text)) && pickers.some((text) => /hair ?style/i.test(text)), pickers.join(', ')));
  await page.locator('input[name="gender"][value="1"]').check({ force: true });
  const suggested = await page.$eval('input[name="hairStyle"]:checked', (input) => input.value);
  results.push(check('picking female suggests long hair', suggested === '1', `hairStyle ${suggested}`));
  await page.locator('#creator h1').click();
  const turned = [];
  for (const [direction, key] of DIRECTIONS) {
    await page.keyboard.press(key);
    turned.push(await page.$eval('#creator canvas.creator-preview', (canvas) => canvas.toDataURL()));
    await page.locator('#creator canvas.creator-preview').screenshot({ path: path.join(PROOF, `02-creator-${direction}.png`) });
  }
  results.push(check('the turning keys show the preview from all four sides', new Set(turned).size === 4, `${new Set(turned).size} different previews`));
  await page.screenshot({ path: path.join(PROOF, '02-creator.png') });
  await page.fill('#creator input[name="name"]', 'Bea');
  await page.click('#creator button[type="submit"]');
  await page.waitForFunction(() => window.__novaland?.sim.tick > 10, null, { timeout: 15000 });
  const playing = await page.evaluate(() => window.__novaland.characters());
  results.push(check('the creator\'s character plays as a woman with long hair', playing.length === 1 && playing[0].name === 'Bea' && playing[0].look.gender === 1 && playing[0].look.hairStyle === 1, JSON.stringify(playing[0])));
  await context.close();
}

async function savedBy32PixelVersion() {
  const character = { name: 'Cal', look: { skin: 4, hair: 3, clothes: 5, gender: 1, hairStyle: 0 } };
  const page = await openPlaying(`http://localhost:${PORT}/`, character, { label: 'saved at 32 px' });
  const shown = await page.evaluate(() => ({ creator: Boolean(document.querySelector('#creator')), characters: window.__novaland.characters(), names: window.__novaland.drawnNames() }));
  const plays = !shown.creator && shown.characters.length === 1 && JSON.stringify(shown.characters[0].look) === JSON.stringify(character.look) && shown.names[0]?.textureKey === 'player/look/4-3-5-1-0';
  results.push(check('a character saved by the 32 px version goes straight into the world with its look', plays, JSON.stringify({ look: shown.characters[0]?.look, texture: shown.names[0]?.textureKey })));
  await page.screenshot({ path: path.join(PROOF, '02-saved-at-32-px.png') });
  await page.context().close();
}

// ---- Helpers ----

/**
 * One 16x24 frame of a sheet the generator painted, in a look's colours, as
 * the same string `textureFrameOf` gives: the four template colours swapped
 * (the clothes' shade derived as the client derives it), everything else
 * kept.
 */
function recolouredFrame(sheet, frameIndex, { skin, hair, clothes }) {
  const rgb = ([r, g, b]) => (r << 16) | (g << 8) | b;
  const shade = (color) => [16, 8, 0].reduce((total, shift) => total | (Math.round(((color >> shift) & 0xff) * 0.75) << shift), 0);
  const swaps = new Map([
    [rgb(generator.TEMPLATE_PALETTE.skin), skin],
    [rgb(generator.TEMPLATE_PALETTE.hair), hair],
    [rgb(generator.TEMPLATE_PALETTE.clothes), clothes],
    [rgb(generator.TEMPLATE_PALETTE.clothesShade), shade(clothes)],
  ]);
  const { FRAME_WIDTH: width, FRAME_HEIGHT: height, FRAMES_PER_DIRECTION: perRow } = generator;
  const left = (frameIndex % perRow) * width;
  const top = Math.floor(frameIndex / perRow) * height;
  const bytes = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * sheet.width + x) * 4;
      const pixel = [...sheet.data.subarray(offset, offset + 4)];
      const swap = pixel[3] === 255 ? swaps.get(rgb(pixel)) : undefined;
      bytes.push(...(swap === undefined ? pixel : [(swap >> 16) & 0xff, (swap >> 8) & 0xff, swap & 0xff, 255]));
    }
  }
  return bytes.join(',');
}

async function newContext() {
  return browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
}

function watchErrors(page, label) {
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${label}: ${message.text()}`));
}

/** A page of a new browser context that remembers `character`, playing and settled. */
async function openPlaying(url, character, { label }) {
  const context = await newContext();
  await rememberCharacter(context, character);
  const page = await context.newPage();
  watchErrors(page, label);
  await page.goto(url);
  await page.waitForFunction(() => window.__novaland?.sim.tick > 30 && window.__novaland.drawnNames().length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return page;
}

function viewOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const camera = api.camera();
    return { pixelsPerMetre: api.pixelsPerMetre, zoom: camera.zoom, visibleMetres: camera.visibleMetres, look: api.characters?.()[0]?.look };
  });
}

/** The local player's sprite: its texture, the frame on show and each direction's idle frame from the def. */
function spriteOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const textureKey = api.drawnNames()[0]?.textureKey;
    const sprite = api.defs.find((def) => def.sprite?.key === 'player').sprite;
    const idleFrames = Object.fromEntries(Object.entries(sprite.directions).map(([direction, frames]) => [direction, frames.idle]));
    const found = [];
    const search = (objects) => {
      for (const object of objects) {
        if (object.texture?.key === textureKey) found.push(object);
        if (object.list) search(object.list);
      }
    };
    search(api.game.scene.getScene('world').children.list);
    return { textureKey, frame: found[0] ? Number(found[0].frame.name) : undefined, idleFrames };
  });
}

/** One frame of a texture the renderer made, as its size and its pixels in one string. */
function textureFrameOf(page, textureKey, frameIndex) {
  return page.evaluate(
    ([key, index]) => {
      const texture = window.__novaland.game.textures.get(key);
      const frame = texture.get(index);
      const canvas = document.createElement('canvas');
      canvas.width = frame.cutWidth;
      canvas.height = frame.cutHeight;
      const context = canvas.getContext('2d');
      context.drawImage(texture.getSourceImage(), frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
      return { size: `${frame.cutWidth}x${frame.cutHeight}`, pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data).join(',') };
    },
    [textureKey, frameIndex],
  );
}

/** The screen rectangle round the local player and its name, in CSS pixels. */
function playerClip(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const camera = api.camera();
    const label = api.drawnNames()[0];
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    const toScreen = (x, y) => ({ x: canvas.left + (x - camera.worldView.x) * camera.zoom, y: canvas.top + (y - camera.worldView.y) * camera.zoom });
    const topLeft = toScreen(label.x - 14, label.y - 4);
    return { x: topLeft.x, y: topLeft.y, width: 28 * camera.zoom, height: 34 * camera.zoom };
  });
}

/** Compares two screenshots in `page` (pixels differing in `middle`, and over the whole screen) and returns both side by side as a PNG in base64. */
function compareAndJoin(page, { before, now }, middle) {
  return page.evaluate(
    async ([beforeUrl, nowUrl, rect]) => {
      const load = (url) => new Promise((resolve) => Object.assign(new Image(), { onload() { resolve(this); }, src: url }));
      const [left, right] = await Promise.all([load(beforeUrl), load(nowUrl)]);
      const pixelsOf = (image) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const a = pixelsOf(left);
      const b = pixelsOf(right);
      let differing = 0;
      let differingWhole = 0;
      for (let y = 0; y < a.height; y += 1) {
        for (let x = 0; x < a.width; x += 1) {
          const offset = (y * a.width + x) * 4;
          if (a.data[offset] === b.data[offset] && a.data[offset + 1] === b.data[offset + 1] && a.data[offset + 2] === b.data[offset + 2]) continue;
          differingWhole += 1;
          if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) differing += 1;
        }
      }
      const gap = 16;
      const joined = Object.assign(document.createElement('canvas'), { width: left.width * 2 + gap, height: left.height + 28 });
      const context = joined.getContext('2d');
      context.fillStyle = '#0b0f14';
      context.fillRect(0, 0, joined.width, joined.height);
      context.drawImage(left, 0, 28);
      context.drawImage(right, left.width + gap, 28);
      context.fillStyle = '#e2e8f0';
      context.font = '16px sans-serif';
      context.fillText('c466e78 (before 32 px)', 8, 20);
      context.fillText('#72 (16 px, gender and hairstyle kept)', left.width + gap + 8, 20);
      return { differing, differingWhole, joined: joined.toDataURL('image/png').split(',')[1] };
    },
    [`data:image/png;base64,${before.toString('base64')}`, `data:image/png;base64,${now.toString('base64')}`, middle],
  );
}

/** Lays PNG crops in a grid, scaled up crisply, in a scratch page. Returns a PNG in base64. */
async function joinGrid(crops, { columns, scale }) {
  const page = await (await newContext()).newPage();
  const joined = await page.evaluate(
    async ([urls, columnCount, factor]) => {
      const load = (url) => new Promise((resolve) => Object.assign(new Image(), { onload() { resolve(this); }, src: url }));
      const images = await Promise.all(urls.map(load));
      const cellWidth = Math.max(...images.map((image) => image.width)) * factor + 8;
      const cellHeight = Math.max(...images.map((image) => image.height)) * factor + 8;
      const canvas = Object.assign(document.createElement('canvas'), { width: cellWidth * columnCount, height: cellHeight * Math.ceil(images.length / columnCount) });
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#0b0f14';
      context.fillRect(0, 0, canvas.width, canvas.height);
      images.forEach((image, index) => context.drawImage(image, (index % columnCount) * cellWidth + 4, Math.floor(index / columnCount) * cellHeight + 4, image.width * factor, image.height * factor));
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [crops.map((crop) => `data:image/png;base64,${crop.toString('base64')}`), columns, scale],
  );
  await page.context().close();
  return joined;
}
