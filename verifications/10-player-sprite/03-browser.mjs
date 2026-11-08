/* global window */
/**
 * V3: the sprite in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium and checks, from the sim state on window.__novaland and the Phaser
 * display list, that: the sheet is served and loaded; the player is a sprite
 * from it (walls stay flat shapes); holding each of the four keys plays that
 * direction's walk cycle and the frame visibly changes; releasing leaves the
 * idle frame of that direction, which persists; every object is depth-sorted
 * by its bottom edge so the player draws in front of a wall it stands south
 * of and behind one it stands north of. Screenshots are the proof.
 * Expected numbers come from the level and the defs, read through the debug API.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5311;
const KEY_FOR = { right: 'KeyD', down: 'KeyS', left: 'KeyA', up: 'KeyW' };
const results = [];
const report = { steps: [] };
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  results.push(check('dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });

  // Content the expectations are derived from.
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const player = api.defs.find((d) => d.name === 'player');
    return { level: api.level, radius: player.radius, sprite: player.sprite, ppm: api.pixelsPerMetre };
  });
  const { level, radius: RADIUS, sprite: SHEET, ppm: PPM } = content;
  const SCALE = PPM / SHEET.pixelsPerMetre;
  const block = level.walls.find((wall) => wall.width === 2 && wall.height === 2 && Math.abs(wall.x) + 1 < level.width / 2 - 1);
  report.content = { ...content, block, scale: SCALE };
  results.push(check('the player def carries a sprite with four directions', SHEET && ['down', 'up', 'left', 'right'].every((d) => SHEET.directions[d])));

  const sheetResponse = await page.request.get(`http://localhost:${PORT}/sprites/${SHEET.key}.png`);
  const sheetBytes = await sheetResponse.body();
  const sheetWidth = sheetBytes.readUInt32BE(16);
  const sheetHeight = sheetBytes.readUInt32BE(20);
  results.push(check('the sheet is served as a PNG', sheetResponse.status() === 200 && sheetResponse.headers()['content-type'].includes('image/png'), `${sheetResponse.status()} ${sheetResponse.headers()['content-type']}`));
  results.push(check('the sheet holds 4x4 frames of the def\'s frame size', sheetWidth === SHEET.frameWidth * 4 && sheetHeight === SHEET.frameHeight * 4, `${sheetWidth}x${sheetHeight}`));

  const loaded = await page.evaluate(() => {
    const api = window.__novaland;
    const scene = api.game.scene.getScene('world');
    const player = api.defs.find((d) => d.name === 'player');
    return {
      texture: api.game.textures.exists(player.sprite.key),
      frames: api.game.textures.get(player.sprite.key).frameTotal,
      animations: ['down', 'up', 'left', 'right'].map((d) => `${player.sprite.key}/walk/${d}`).filter((key) => scene.anims.exists(key)),
    };
  });
  results.push(check('Phaser loaded the sheet as a texture with 16 frames', loaded.texture && loaded.frames === 16 + 1, `${loaded.frames - 1} frames`)); // frameTotal counts the __BASE frame
  results.push(check('the four walk animations are registered', loaded.animations.length === 4, loaded.animations.join(', ')));
  report.loaded = loaded;

  /** Sim state and the drawn objects, read in the same frame. */
  const state = () =>
    page.evaluate(() => {
      const api = window.__novaland;
      const s = api.snapshot();
      const p = s.entities.find((e) => e.components.Player);
      const scene = api.game.scene.getScene('world');
      const objects = scene.children.list;
      const sprites = objects.filter((o) => o.type === 'Sprite');
      const sprite = sprites[0];
      const hud = objects.find((o) => o.type === 'Text');
      return {
        tick: s.tick,
        x: p.components.Position.x,
        y: p.components.Position.y,
        intent: p.components.MoveIntent,
        facing: p.components.Facing,
        spriteCount: sprites.length,
        sprite: sprite && {
          x: sprite.x,
          y: sprite.y,
          depth: sprite.depth,
          texture: sprite.texture.key,
          frame: Number(sprite.frame.name),
          animation: sprite.anims.currentAnim ? sprite.anims.currentAnim.key : null,
          playing: sprite.anims.isPlaying,
          scaleX: sprite.scaleX,
          scaleY: sprite.scaleY,
          originX: sprite.originX,
          originY: sprite.originY,
          displayWidth: sprite.displayWidth,
          displayHeight: sprite.displayHeight,
        },
        rectangles: objects.filter((o) => o.type === 'Rectangle').map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height, depth: o.depth })),
        hudDepth: hud ? hud.depth : null,
      };
    });
  /** Holds keys for `ms`, sampling the state every `every` ms, then releases and samples again after a short settle. */
  const hold = async (keys, ms, every = 30) => {
    for (const k of keys) await page.keyboard.down(k);
    const samples = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      samples.push(await state());
      await page.waitForTimeout(every);
    }
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(150);
    return { samples, after: await state() };
  };
  const unit = (x, y) => ({ x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) });
  const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

  const initial = await state();
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-idle-at-spawn.png') });
  report.steps.push({ step: 'initial', ...initial });
  results.push(check('the player is drawn as one sprite from the sheet, not a circle', initial.spriteCount === 1 && initial.sprite.texture === SHEET.key, `${initial.spriteCount} sprite(s), texture ${initial.sprite && initial.sprite.texture}`));
  results.push(check('walls without a sprite still draw as flat rectangles (fallback)', initial.rectangles.length === level.walls.length, `${initial.rectangles.length} rectangles`));
  results.push(check(`the sprite is scaled by ${PPM}/${SHEET.pixelsPerMetre} with the def's origin`, near(initial.sprite.scaleX, SCALE) && near(initial.sprite.scaleY, SCALE) && near(initial.sprite.originX, SHEET.origin.x) && near(initial.sprite.originY, SHEET.origin.y) && near(initial.sprite.displayWidth, SHEET.frameWidth * SCALE) && near(initial.sprite.displayHeight, SHEET.frameHeight * SCALE), `${initial.sprite.displayWidth}x${initial.sprite.displayHeight} px`));
  results.push(check('a freshly spawned player stands still on the idle-down frame', !initial.sprite.playing && initial.sprite.frame === SHEET.directions.down.idle && initial.facing.x === 0 && initial.facing.y === 1, `frame ${initial.sprite.frame}`));

  // One pass per direction, in an order that keeps the player away from every wall.
  const walkSamples = [];
  for (const direction of ['right', 'down', 'left', 'up']) {
    const frames = SHEET.directions[direction];
    const walkFrames = [];
    for (let f = frames.walk.start; f <= frames.walk.end; f += 1) walkFrames.push(f);
    const { samples, after } = await hold([KEY_FOR[direction]], 700);
    if (direction === 'right') await page.screenshot({ path: path.join(PROOF, '03-browser-2-walking-right.png') });
    const moving = samples.filter((s) => s.intent.x !== 0 || s.intent.y !== 0);
    const seenFrames = [...new Set(moving.map((s) => s.sprite.frame))].sort((a, b) => a - b);
    const animationKey = `${SHEET.key}/walk/${direction}`;
    const expectedFacing = unit(moving[0] ? moving[0].intent.x : 0, moving[0] ? moving[0].intent.y : 1);
    results.push(check(`${direction}: the ${animationKey} animation plays while the key is held`, moving.length > 10 && moving.every((s) => s.sprite.playing && s.sprite.animation === animationKey), `${moving.length} moving samples`));
    results.push(check(`${direction}: the frame changes while walking, within that direction's row`, seenFrames.length >= 3 && seenFrames.every((f) => walkFrames.includes(f)), `frames ${seenFrames.join(',')}`));
    results.push(check(`${direction}: releasing the key leaves the idle frame of that direction`, !after.sprite.playing && after.sprite.frame === frames.idle && after.intent.x === 0 && after.intent.y === 0, `frame ${after.sprite.frame}`));
    results.push(check(`${direction}: the sim facing is the unit vector of the last move`, near(after.facing.x, expectedFacing.x) && near(after.facing.y, expectedFacing.y), JSON.stringify(after.facing)));
    await page.waitForTimeout(500);
    const later = await state();
    results.push(check(`${direction}: the facing frame persists half a second after the release`, !later.sprite.playing && later.sprite.frame === frames.idle && later.facing.x === after.facing.x && later.facing.y === after.facing.y, `frame ${later.sprite.frame}`));
    if (direction === 'up') await page.screenshot({ path: path.join(PROOF, '03-browser-3-facing-up-after-release.png') });
    walkSamples.push(...samples, after, later);
    report.steps.push({ step: `walk-${direction}`, seenFrames, after, later });
  }

  // The drawn sprite tracks the sim position and every object is depth-sorted by its bottom edge.
  const tracked = walkSamples.every((s) => near(s.sprite.x, s.x * PPM, 1e-6) && near(s.sprite.y, s.y * PPM, 1e-6));
  results.push(check(`the sprite sits where the sim says (${PPM} px/m) in ${walkSamples.length} samples`, tracked));
  const playerDepth = walkSamples.every((s) => near(s.sprite.depth, (s.y + RADIUS) * PPM, 1e-6));
  const wallDepth = initial.rectangles.every((r) => near(r.depth, r.y + r.height / 2, 1e-6));
  results.push(check('the player and every wall have depth = bottom edge in pixels', playerDepth && wallDepth));
  results.push(check('the HUD is above everything', initial.hudDepth > Math.max(...initial.rectangles.map((r) => r.depth), initial.sprite.depth)));

  // Stand just south of the 2x2 inner block: the body is below it, the sprite overlaps it, and it draws in front.
  await hold(['KeyD'], (block.x / 5) * 1000);
  const front = (await hold(['KeyW'], 1500)).after;
  await page.screenshot({ path: path.join(PROOF, '03-browser-4-in-front-of-block.png') });
  const blockRectangle = initial.rectangles.find((r) => near(r.x, block.x * PPM, 1e-6) && near(r.y, block.y * PPM, 1e-6));
  const southFace = block.y + block.height / 2;
  const spriteTop = front.sprite.y - front.sprite.displayHeight * front.sprite.originY;
  results.push(check('the player stopped against the south face of the block', near(front.y, southFace + RADIUS, 0.05) && Math.abs(front.x - block.x) < block.width / 2, `y=${front.y.toFixed(3)}, face at ${(southFace + RADIUS).toFixed(2)}`));
  results.push(check('its sprite overlaps the block and is drawn in front of it (greater depth)', spriteTop < blockRectangle.y + blockRectangle.height / 2 && front.sprite.depth > blockRectangle.depth, `sprite depth ${front.sprite.depth.toFixed(1)} > block ${blockRectangle.depth.toFixed(1)}`));
  await page.screenshot({ path: path.join(PROOF, '03-browser-4-in-front-of-block-zoom.png'), clip: { x: 480 + block.x * PPM - 80, y: 360 + block.y * PPM - 80, width: 160, height: 180 } });
  report.steps.push({ step: 'in-front', ...front, blockRectangle, spriteTop });

  // Walk around to the north side and push against it: now the player is behind (lower depth).
  await hold(['KeyA'], 500);
  await hold(['KeyW'], 800);
  await hold(['KeyD'], 500);
  const behind = (await hold(['KeyS'], 1500)).after;
  await page.screenshot({ path: path.join(PROOF, '03-browser-5-behind-block.png') });
  const northFace = block.y - block.height / 2;
  results.push(check('the player stopped against the north face of the block', near(behind.y, northFace - RADIUS, 0.05) && Math.abs(behind.x - block.x) < block.width / 2, `y=${behind.y.toFixed(3)}, face at ${(northFace - RADIUS).toFixed(2)}`));
  results.push(check('there it is drawn behind the block (lower depth), facing down', behind.sprite.depth < blockRectangle.depth && behind.sprite.frame === SHEET.directions.down.idle, `sprite depth ${behind.sprite.depth.toFixed(1)} < block ${blockRectangle.depth.toFixed(1)}`));
  report.steps.push({ step: 'behind', ...behind });

  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);
