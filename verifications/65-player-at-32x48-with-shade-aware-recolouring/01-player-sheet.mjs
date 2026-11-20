/* global window */
/**
 * #65 end to end, in the real client (solo, `pnpm dev`): the player is the
 * 32x48 sheet, drawn at the size the def says on today's tiles, recoloured in
 * every shade of every part for each look, and walks all four directions
 * through the four frames of its row. The creator's preview shows the new
 * sheet too. Screenshots of each go into ./proof.
 *
 * Expected numbers come from the def (`window.__novaland.defs`), the
 * palettes (`characterPalettes`) and the generator's template palette.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const { TEMPLATE_PALETTE, FIXED_PALETTE } = await import(pathToFileURL(path.join(ROOT, 'packages/client/tools/generate-player-sheet.mjs')).href);

/** Not the port of the dev server left running for the human (5165). */
const PORT = 5965;
/** Wide enough for a camera zoom that draws each sheet pixel on whole screen pixels at half scale, so the proof is crisp. */
const VIEWPORT = { width: 1920, height: 1080 };
/** Looks that stress the derivation: the template's own, the lightest and darkest swatches, and a few in between. */
const LOOKS = [
  { skin: 1, hair: 1, clothes: 0 },
  { skin: 0, hair: 4, clothes: 3 },
  { skin: 5, hair: 0, clothes: 7 },
  { skin: 3, hair: 6, clothes: 4 },
];
/** Which template colours belong to which part, and what each is to the picked colour. */
const TEMPLATE_PARTS = [
  { template: 'skin', part: 'skin', kind: 'base' },
  { template: 'skinShade', part: 'skin', kind: 'shade' },
  { template: 'hair', part: 'hair', kind: 'base' },
  { template: 'hairShade', part: 'hair', kind: 'shade' },
  { template: 'hairLight', part: 'hair', kind: 'light' },
  { template: 'shirt', part: 'clothes', kind: 'base' },
  { template: 'shirtShade', part: 'clothes', kind: 'shade' },
  { template: 'shirtLight', part: 'clothes', kind: 'light' },
];
const WALKS = [
  { direction: 'down', key: 'KeyS' },
  { direction: 'up', key: 'KeyW' },
  { direction: 'left', key: 'KeyA' },
  { direction: 'right', key: 'KeyD' },
];
const results = [];
const report = { looks: [], walks: [] };
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');
  browser = await chromium.launch();

  for (const [index, look] of LOOKS.entries()) {
    const page = await openAs(browser, { name: `Look ${index}`, look });
    const drawn = await waitFor('the player drawn from its look texture', { read: () => playerSpriteOf(page), until: (sprite) => sprite?.textureKey.includes('/look/'), timeoutMs: 15000 });
    if (index === 0) {
      const { sprite } = await page.evaluate(() => ({ sprite: window.__novaland.defs.find((def) => def.name === 'player').sprite }));
      report.sprite = sprite;
      results.push(check('the def declares 32x48 frames', sprite.frameWidth === 32 && sprite.frameHeight === 48, `${sprite.frameWidth}x${sprite.frameHeight} at ${sprite.pixelsPerMetre} px/m`));
      results.push(check('the loaded sheet is four rows of four of those frames', drawn.sheetWidth === sprite.frameWidth * 4 && drawn.sheetHeight === sprite.frameHeight * 4 && drawn.frameCount >= 16, `${drawn.sheetWidth}x${drawn.sheetHeight}, ${drawn.frameCount} frames`));
      const scale = drawn.pixelsPerMetre / sprite.pixelsPerMetre;
      results.push(check('the player is drawn at the def\'s size in world pixels (half scale on 16 px tiles)', Math.abs(drawn.displayWidth - sprite.frameWidth * scale) < 1e-6 && Math.abs(drawn.displayHeight - sprite.frameHeight * scale) < 1e-6, `${drawn.displayWidth}x${drawn.displayHeight} world px, ${drawn.displayHeight / drawn.pixelsPerMetre} m tall`));
    }
    const recolour = await recolourReport(page, drawn.textureKey, look);
    report.looks.push({ look, ...recolour });
    results.push(check(`look ${JSON.stringify(look)}: every template colour became one colour, the right one for its part`, recolour.problems.length === 0, recolour.problems.join('; ') || JSON.stringify(recolour.colors)));
    await page.screenshot({ path: path.join(PROOF, `look-${index}.png`), clip: await clipAround(page) });

    if (index === 0) {
      for (const walk of WALKS) {
        const { idle, range } = await page.evaluate((direction) => {
          const frames = window.__novaland.defs.find((def) => def.name === 'player').sprite.directions[direction];
          return { idle: frames.idle, range: frames.walk };
        }, walk.direction);
        await page.keyboard.down(walk.key);
        // The frame before the turn is the last direction's; count from the first frame of this row.
        await waitFor(`the player to turn ${walk.direction}`, { read: () => playerSpriteOf(page), until: (sprite) => Number(sprite.frame) >= range.start && Number(sprite.frame) <= range.end }).catch(() => undefined);
        const frames = new Set();
        let midWalk;
        const until = Date.now() + 1200;
        while (Date.now() < until) {
          const sprite = await playerSpriteOf(page);
          frames.add(Number(sprite.frame));
          if (!midWalk && frames.size >= 2 && Date.now() > until - 600) midWalk = await page.screenshot({ path: path.join(PROOF, `walk-${walk.direction}.png`), clip: await clipAround(page) });
          await page.waitForTimeout(25);
        }
        await page.keyboard.up(walk.key);
        const expected = Array.from({ length: range.end - range.start + 1 }, (_, offset) => range.start + offset);
        const walked = [...frames].sort((a, b) => a - b);
        report.walks.push({ direction: walk.direction, frames: walked, expected });
        results.push(check(`walking ${walk.direction} plays all four frames of its row`, expected.every((frame) => frames.has(frame)) && walked.every((frame) => expected.includes(frame)), `saw ${walked.join(',')}, row ${expected.join(',')}`));
        await waitFor('the player to stand', { read: () => playerSpriteOf(page), until: (sprite) => Number(sprite.frame) === idle }).catch(() => undefined);
      }
    }
    await page.context().close();
  }

  // The creator, for a first visit: its preview is the new sheet's first frame at the same on-screen size as before.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#creator canvas.creator-preview');
  await page.waitForFunction(() => document.querySelector('#creator canvas.creator-preview')?.dataset.look !== undefined);
  const preview = await page.evaluate(() => {
    const canvas = document.querySelector('#creator canvas.creator-preview');
    const sprite = window.__novaland?.defs?.find((def) => def.name === 'player')?.sprite;
    return { width: canvas.width, height: canvas.height, look: canvas.dataset.look, frame: sprite ? [sprite.frameWidth, sprite.frameHeight] : undefined };
  });
  report.creatorPreview = preview;
  results.push(check('the creator previews the character at 96x144, three screen pixels per sheet pixel', preview.width === 96 && preview.height === 144, JSON.stringify(preview)));
  await page.locator('#creator').screenshot({ path: path.join(PROOF, 'creator.png') });
  await context.close();

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('01-player-sheet.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

async function openAs(browser, character) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, character);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(message.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });
  return page;
}

/** The local player's sprite as the world scene draws it. */
function playerSpriteOf(page) {
  return page.evaluate(() => {
    const scene = window.__novaland.game.scene.getScene('world');
    const sprite = scene.children.list.find((child) => child.type === 'Sprite' && child.texture.key.startsWith('player'));
    if (!sprite) return undefined;
    const source = sprite.texture.getSourceImage();
    const camera = scene.cameras.main;
    return {
      textureKey: sprite.texture.key,
      frame: sprite.frame.name,
      frameCount: sprite.texture.frameTotal - 1,
      sheetWidth: source.width,
      sheetHeight: source.height,
      displayWidth: sprite.displayWidth,
      displayHeight: sprite.displayHeight,
      pixelsPerMetre: window.__novaland.pixelsPerMetre,
      screen: { x: (sprite.x - camera.worldView.x) * camera.zoom, y: (sprite.y - camera.worldView.y) * camera.zoom, zoom: camera.zoom },
    };
  });
}

/** A screenshot region around the player, a little bigger than the character. */
async function clipAround(page) {
  const sprite = await playerSpriteOf(page);
  const width = sprite.displayWidth * sprite.screen.zoom * 2.5;
  const height = sprite.displayHeight * sprite.screen.zoom * 1.8;
  return { x: Math.max(0, sprite.screen.x - width / 2), y: Math.max(0, sprite.screen.y - height * 0.7), width, height };
}

/**
 * Compares the template sheet with the look's texture pixel by pixel: every
 * pixel in a template colour must have become one colour per template colour,
 * the picked swatch for a base, darker than it for a shade and lighter for a
 * highlight; every other pixel must be untouched.
 */
async function recolourReport(page, textureKey, look) {
  const colors = await page.evaluate(
    ({ textureKey, templates }) => {
      const textures = window.__novaland.game.textures;
      const pixelsOf = (key) => {
        const source = textures.get(key).getSourceImage();
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        context.drawImage(source, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const template = pixelsOf('player');
      const looked = pixelsOf(textureKey);
      const rgb = (data, offset) => (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
      const becameFrom = {};
      let untouchedChanged = 0;
      for (let offset = 0; offset < template.length; offset += 4) {
        if (template[offset + 3] !== 255) continue;
        const before = rgb(template, offset);
        const after = rgb(looked, offset);
        const name = templates[before];
        if (name) (becameFrom[name] ??= new Set()).add(after);
        else if (after !== before) untouchedChanged += 1;
      }
      return { becameFrom: Object.fromEntries(Object.entries(becameFrom).map(([name, set]) => [name, [...set]])), untouchedChanged };
    },
    { textureKey, templates: Object.fromEntries(Object.entries(TEMPLATE_PALETTE).map(([name, color]) => [rgb(color), name])) },
  );
  const palettes = await page.evaluate(() => window.__novaland.characterPalettes);
  const problems = [];
  if (colors.untouchedChanged > 0) problems.push(`${colors.untouchedChanged} fixed-colour pixels changed`);
  const fixed = new Set(Object.values(FIXED_PALETTE).map(rgb));
  for (const { template, part, kind } of TEMPLATE_PARTS) {
    const became = colors.becameFrom[template] ?? [];
    const picked = palettes[part][look[part]].color;
    if (became.length !== 1) {
      problems.push(`${template} became ${became.length} colours`);
      continue;
    }
    const [color] = became;
    if (kind === 'base' && color !== picked) problems.push(`${template} is ${hex(color)}, not the picked ${hex(picked)}`);
    if (kind === 'shade' && !(brightness(color) < brightness(picked))) problems.push(`${template} ${hex(color)} is not darker than ${hex(picked)}`);
    if (kind === 'light' && !(brightness(color) > brightness(picked))) problems.push(`${template} ${hex(color)} is not lighter than ${hex(picked)}`);
    if (fixed.has(color) && kind !== 'base') problems.push(`${template} became the fixed colour ${hex(color)}`);
  }
  return { problems, colors: Object.fromEntries(Object.entries(colors.becameFrom).map(([name, list]) => [name, list.map(hex)])) };
}

function rgb([r, g, b]) {
  return (r << 16) | (g << 8) | b;
}

function hex(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function brightness(color) {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}
