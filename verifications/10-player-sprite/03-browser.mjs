/* global window */
/**
 * V3: the sprite in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium and checks, from the sim state on window.__novaland and the Phaser
 * display list, that: the sheet is served and loaded; the player is a sprite
 * from it, drawn over the tile terrain; holding each of the four keys plays
 * that direction's walk cycle and the frame visibly changes; releasing leaves
 * the idle frame of that direction, which persists; the sprite is depth-sorted
 * by its bottom edge, so standing south of a block of trees it overlaps them
 * and is in front, and north of them its bottom edge is above theirs; the
 * level camera keeps the sprite in the middle of the screen (unless pinned at
 * a level edge) at a whole-number zoom and the sheet is drawn with
 * nearest-neighbour filtering, so the pixels stay crisp. Screenshots are the proof.
 * Expected numbers come from the level grid, the defs and the camera, read
 * through the debug API.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5311;
/** CSS pixels; the page is opened at a pixel ratio of 1 so screen pixels, device pixels and CSS pixels agree. */
const VIEWPORT = { width: 960, height: 720 };
const KEY_FOR = { right: 'KeyD', down: 'KeyS', left: 'KeyA', up: 'KeyW' };
const PHASER_NEAREST_SCALE_MODE = 1; // Phaser.ScaleModes.NEAREST
const results = [];
const report = { steps: [] };
const server = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  results.push(check('dev server up', await waitForPort(PORT)));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10, null, { timeout: 15000 });

  // Content the expectations are derived from.
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const player = api.defs.find((def) => def.name === 'player');
    const tiles = api.defs.filter((def) => typeof def.solid === 'boolean');
    return {
      grid: api.grid,
      tiles,
      spawn: api.tileCentre(api.grid, api.level.spawn),
      radius: player.radius,
      speed: player.speed,
      sprite: player.sprite,
      pixelsPerMetre: api.pixelsPerMetre,
    };
  });
  const { grid, tiles, spawn: SPAWN, radius: RADIUS, speed: SPEED, sprite: SHEET, pixelsPerMetre: PIXELS_PER_METRE } = content;
  const SCALE = PIXELS_PER_METRE / SHEET.pixelsPerMetre;
  const block = nearestTwoByTwoSolidBlock(grid, tiles, SPAWN);
  report.content = { ...content, grid: { columns: grid.columns, rows: grid.rows, tileSize: grid.tileSize }, block, scale: SCALE };
  results.push(check('the player def carries a sprite with four directions', SHEET && ['down', 'up', 'left', 'right'].every((direction) => SHEET.directions[direction])));
  results.push(check('the level has a free-standing 2x2 block of solid tiles to stand around', block !== undefined, JSON.stringify(block)));

  const sheetResponse = await page.request.get(`http://localhost:${PORT}/sprites/${SHEET.key}.png`);
  const sheetBytes = await sheetResponse.body();
  const sheetWidth = sheetBytes.readUInt32BE(16);
  const sheetHeight = sheetBytes.readUInt32BE(20);
  results.push(check('the sheet is served as a PNG', sheetResponse.status() === 200 && sheetResponse.headers()['content-type'].includes('image/png'), `${sheetResponse.status()} ${sheetResponse.headers()['content-type']}`));
  results.push(check("the sheet holds 4x4 frames of the def's frame size", sheetWidth === SHEET.frameWidth * 4 && sheetHeight === SHEET.frameHeight * 4, `${sheetWidth}x${sheetHeight}`));

  const loaded = await page.evaluate(() => {
    const api = window.__novaland;
    const scene = api.game.scene.getScene('world');
    const player = api.defs.find((def) => def.name === 'player');
    return {
      texture: api.game.textures.exists(player.sprite.key),
      frames: api.game.textures.get(player.sprite.key).frameTotal,
      scaleMode: api.game.textures.get(player.sprite.key).source[0].scaleMode,
      pixelArt: api.game.config.pixelArt,
      animations: ['down', 'up', 'left', 'right'].map((direction) => `${player.sprite.key}/walk/${direction}`).filter((key) => scene.anims.exists(key)),
    };
  });
  results.push(check('Phaser loaded the sheet as a texture with 16 frames', loaded.texture && loaded.frames === 16 + 1, `${loaded.frames - 1} frames`)); // frameTotal counts the __BASE frame
  results.push(check('the four walk animations are registered', loaded.animations.length === 4, loaded.animations.join(', ')));
  results.push(check('the sheet is drawn with nearest-neighbour filtering (pixel art stays crisp)', loaded.scaleMode === PHASER_NEAREST_SCALE_MODE && loaded.pixelArt === true, `scaleMode ${loaded.scaleMode}, pixelArt ${loaded.pixelArt}`));
  report.loaded = loaded;

  /** Sim state, the camera and the drawn objects, read in the same frame. */
  const state = () =>
    page.evaluate(() => {
      const api = window.__novaland;
      const snapshot = api.snapshot();
      const playerEntity = snapshot.entities.find((entity) => entity.components.Player);
      const scene = api.game.scene.getScene('world');
      const objects = scene.children.list;
      const sprites = objects.filter((object) => object.type === 'Sprite');
      const sprite = sprites[0];
      const terrain = objects.find((object) => object.type === 'TilemapLayer');
      return {
        tick: snapshot.tick,
        camera: api.camera(),
        x: playerEntity.components.Position.x,
        y: playerEntity.components.Position.y,
        intent: playerEntity.components.MoveIntent,
        facing: playerEntity.components.Facing,
        spriteCount: sprites.length,
        circleCount: objects.filter((object) => object.type === 'Arc').length,
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
        terrainDepth: terrain ? terrain.depth : null,
        hud: { active: api.game.scene.isActive('hud'), drawnAfterWorld: api.game.scene.getIndex('hud') > api.game.scene.getIndex('world') },
      };
    });
  /** Holds keys for `ms`, sampling the state every `every` ms, then releases and samples again after a short settle. */
  const hold = async (keys, ms, every = 30) => {
    for (const key of keys) await page.keyboard.down(key);
    const samples = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      samples.push(await state());
      await page.waitForTimeout(every);
    }
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(150);
    return { samples, after: await state() };
  };
  const unitVector = (x, y) => ({ x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) });
  const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
  /** Where a world pixel lands on the screen, in CSS pixels, given the camera of the same sample. */
  const onScreen = (sample, worldX, worldY) => ({
    x: (worldX - sample.camera.worldView.x) * sample.camera.zoom,
    y: (worldY - sample.camera.worldView.y) * sample.camera.zoom,
  });
  /**
   * On each axis the camera keeps the sprite in the middle of the screen, give or take the device pixel it snaps
   * to, unless the view is pinned at a level edge on that axis; then the sprite is on the edge's side of the middle.
   */
  const centredOnSprite = (sample) => {
    const screen = onScreen(sample, sample.sprite.x, sample.sprite.y);
    const { worldView, bounds, zoom } = sample.camera;
    const axis = (position, middle, viewStart, viewSize, boundStart, boundSize) => {
      if (near(position, middle, zoom)) return true;
      const pinnedAtStart = near(viewStart, boundStart, 1e-6);
      const pinnedAtEnd = near(viewStart + viewSize, boundStart + boundSize, 1e-6);
      return (pinnedAtStart && position < middle) || (pinnedAtEnd && position > middle);
    };
    return axis(screen.x, VIEWPORT.width / 2, worldView.x, worldView.width, bounds.x, bounds.width) && axis(screen.y, VIEWPORT.height / 2, worldView.y, worldView.height, bounds.y, bounds.height);
  };

  const initial = await state();
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-idle-at-spawn.png') });
  report.steps.push({ step: 'initial', ...initial });
  results.push(check('the player is drawn as one sprite from the sheet, not a circle', initial.spriteCount === 1 && initial.circleCount === 0 && initial.sprite.texture === SHEET.key, `${initial.spriteCount} sprite(s), ${initial.circleCount} circle(s), texture ${initial.sprite && initial.sprite.texture}`));
  results.push(check('the terrain tilemap is drawn below the sprite', initial.terrainDepth !== null && initial.terrainDepth < initial.sprite.depth, `terrain depth ${initial.terrainDepth}, sprite depth ${initial.sprite.depth}`));
  results.push(check(`the sprite is scaled by ${PIXELS_PER_METRE}/${SHEET.pixelsPerMetre} with the def's origin`, near(initial.sprite.scaleX, SCALE) && near(initial.sprite.scaleY, SCALE) && near(initial.sprite.originX, SHEET.origin.x) && near(initial.sprite.originY, SHEET.origin.y) && near(initial.sprite.displayWidth, SHEET.frameWidth * SCALE) && near(initial.sprite.displayHeight, SHEET.frameHeight * SCALE), `${initial.sprite.displayWidth}x${initial.sprite.displayHeight} px`));
  results.push(check('a freshly spawned player stands still on the idle-down frame', !initial.sprite.playing && initial.sprite.frame === SHEET.directions.down.idle && initial.facing.x === 0 && initial.facing.y === 1, `frame ${initial.sprite.frame}`));
  results.push(check('the player spawned at the centre of the spawn tile', near(initial.x, SPAWN.x, 1e-6) && near(initial.y, SPAWN.y, 1e-6), `(${initial.x}, ${initial.y})`));

  // One pass per direction, in an order that keeps the player on open ground around the spawn.
  const walkSamples = [];
  for (const direction of ['right', 'down', 'left', 'up']) {
    const frames = SHEET.directions[direction];
    const walkFrames = [];
    for (let frame = frames.walk.start; frame <= frames.walk.end; frame += 1) walkFrames.push(frame);
    const { samples, after } = await hold([KEY_FOR[direction]], 700);
    if (direction === 'right') await page.screenshot({ path: path.join(PROOF, '03-browser-2-walking-right.png') });
    const moving = samples.filter((sample) => sample.intent.x !== 0 || sample.intent.y !== 0);
    const seenFrames = [...new Set(moving.map((sample) => sample.sprite.frame))].sort((a, b) => a - b);
    const animationKey = `${SHEET.key}/walk/${direction}`;
    const expectedFacing = unitVector(moving[0] ? moving[0].intent.x : 0, moving[0] ? moving[0].intent.y : 1);
    results.push(check(`${direction}: the ${animationKey} animation plays while the key is held`, moving.length > 10 && moving.every((sample) => sample.sprite.playing && sample.sprite.animation === animationKey), `${moving.length} moving samples`));
    results.push(check(`${direction}: the frame changes while walking, within that direction's row`, seenFrames.length >= 3 && seenFrames.every((frame) => walkFrames.includes(frame)), `frames ${seenFrames.join(',')}`));
    results.push(check(`${direction}: releasing the key leaves the idle frame of that direction`, !after.sprite.playing && after.sprite.frame === frames.idle && after.intent.x === 0 && after.intent.y === 0, `frame ${after.sprite.frame}`));
    results.push(check(`${direction}: the sim facing is the unit vector of the last move`, near(after.facing.x, expectedFacing.x) && near(after.facing.y, expectedFacing.y), JSON.stringify(after.facing)));
    await page.waitForTimeout(500);
    const later = await state();
    results.push(check(`${direction}: the facing frame persists half a second after the release`, !later.sprite.playing && later.sprite.frame === frames.idle && later.facing.x === after.facing.x && later.facing.y === after.facing.y, `frame ${later.sprite.frame}`));
    if (direction === 'up') await page.screenshot({ path: path.join(PROOF, '03-browser-3-facing-up-after-release.png') });
    walkSamples.push(...samples, after, later);
    report.steps.push({ step: `walk-${direction}`, seenFrames, after, later });
  }

  // Stand just south of the 2x2 block of solid tiles: the body is below it, the sprite overlaps it, and its depth puts it in front.
  // The walk east is timed from the def speed; the push north runs long enough to be blocked whatever the start.
  await hold(['KeyD'], ((block.x - SPAWN.x) / SPEED) * 1000);
  const { samples: approachSamples, after: front } = await hold(['KeyW'], 1500);
  await page.screenshot({ path: path.join(PROOF, '03-browser-4-in-front-of-block.png') });
  const blockBottomEdgeDepth = (block.y + block.height / 2) * PIXELS_PER_METRE;
  const southFace = block.y + block.height / 2;
  const spriteTop = front.sprite.y - front.sprite.displayHeight * front.sprite.originY;
  results.push(check('the player stopped against the south face of the block', near(front.y, southFace + RADIUS, 0.05) && Math.abs(front.x - block.x) < block.width / 2, `y=${front.y.toFixed(3)}, face at ${(southFace + RADIUS).toFixed(2)}`));
  results.push(check("its sprite overlaps the block and its depth is greater than the block's bottom edge, so it draws in front", spriteTop < blockBottomEdgeDepth && front.sprite.depth > blockBottomEdgeDepth && front.sprite.depth > front.terrainDepth, `sprite top ${spriteTop.toFixed(1)}, depth ${front.sprite.depth.toFixed(1)} > block ${blockBottomEdgeDepth.toFixed(1)}`));
  const blockOnScreen = onScreen(front, block.x * PIXELS_PER_METRE, block.y * PIXELS_PER_METRE);
  const clipMetres = { width: 5, height: 6 };
  const clip = {
    x: Math.round(blockOnScreen.x - (clipMetres.width / 2) * PIXELS_PER_METRE * front.camera.zoom),
    y: Math.round(blockOnScreen.y - (clipMetres.height / 2) * PIXELS_PER_METRE * front.camera.zoom),
    width: clipMetres.width * PIXELS_PER_METRE * front.camera.zoom,
    height: clipMetres.height * PIXELS_PER_METRE * front.camera.zoom,
  };
  await page.screenshot({ path: path.join(PROOF, '03-browser-4-in-front-of-block-zoom.png'), clip });
  report.steps.push({ step: 'in-front', ...front, blockBottomEdgeDepth, spriteTop, clip });

  // Walk around to the north side and push against it: now the sprite's bottom edge is above the block's, so it would sort behind.
  const detour = [await hold(['KeyA'], 500), await hold(['KeyW'], 800), await hold(['KeyD'], 500)];
  const { samples: returnSamples, after: behind } = await hold(['KeyS'], 1500);
  await page.screenshot({ path: path.join(PROOF, '03-browser-5-behind-block.png') });
  const northFace = block.y - block.height / 2;
  results.push(check('the player stopped against the north face of the block', near(behind.y, northFace - RADIUS, 0.05) && Math.abs(behind.x - block.x) < block.width / 2, `y=${behind.y.toFixed(3)}, face at ${(northFace - RADIUS).toFixed(2)}`));
  results.push(check("there its depth is below the block's bottom edge (it would sort behind a y-sorted object there), facing down", behind.sprite.depth < blockBottomEdgeDepth && behind.sprite.frame === SHEET.directions.down.idle, `sprite depth ${behind.sprite.depth.toFixed(1)} < block ${blockBottomEdgeDepth.toFixed(1)}`));
  report.steps.push({ step: 'behind', ...behind });

  // Across every sample: the sprite tracks the sim, its depth is its bottom edge, and the camera follows it crisply.
  const allSamples = [...walkSamples, ...approachSamples, front, ...detour.flatMap(({ samples, after }) => [...samples, after]), ...returnSamples, behind];
  const tracked = allSamples.every((sample) => near(sample.sprite.x, sample.x * PIXELS_PER_METRE, 1e-6) && near(sample.sprite.y, sample.y * PIXELS_PER_METRE, 1e-6));
  results.push(check(`the sprite sits where the sim says (${PIXELS_PER_METRE} px/m) in ${allSamples.length} samples`, tracked));
  results.push(check('the sprite depth is its bottom edge in pixels in every sample', allSamples.every((sample) => near(sample.sprite.depth, (sample.y + RADIUS) * PIXELS_PER_METRE, 1e-6))));
  results.push(check('the HUD is its own scene, drawn after the world, so no depth can cover it', initial.hud.active && initial.hud.drawnAfterWorld));
  const zoom = initial.camera.zoom;
  results.push(check(`the camera zoom is a whole number (${zoom}x), so every sprite pixel is ${zoom} screen pixels`, Number.isInteger(zoom) && zoom >= 1 && allSamples.every((sample) => sample.camera.zoom === zoom), `zoom ${zoom}`));
  const offCentre = allSamples.find((sample) => !centredOnSprite(sample));
  results.push(check(`the camera keeps the sprite in the middle of the screen (or against a pinned edge) through ${allSamples.length} samples`, offCentre === undefined, offCentre ? JSON.stringify({ sprite: onScreen(offCentre, offCentre.sprite.x, offCentre.sprite.y), view: offCentre.camera.worldView }) : ''));
  const centredSamples = allSamples.filter((sample) => near(onScreen(sample, sample.sprite.x, sample.sprite.y).x, VIEWPORT.width / 2, zoom) && near(onScreen(sample, sample.sprite.x, sample.sprite.y).y, VIEWPORT.height / 2, zoom));
  results.push(check('the sprite was dead centre on both axes in some samples', centredSamples.length > 5, `${centredSamples.length} samples`));
  const scrolled = allSamples.some((sample) => !near(sample.camera.scrollX, initial.camera.scrollX, 1e-6)) && allSamples.some((sample) => !near(sample.camera.scrollY, initial.camera.scrollY, 1e-6));
  results.push(check('the camera scrolled on both axes to follow the walk', scrolled));

  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/**
 * The 2x2 square of solid tiles nearest to a point, with no solid tile in the ring around it, as a box in metres
 * (centre, width, height). Undefined when the level has none.
 */
function nearestTwoByTwoSolidBlock(grid, tiles, point) {
  const solidById = new Map(tiles.map((tile) => [tile.id, tile.solid]));
  const solidAt = (column, row) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && solidById.get(grid.defIds[row][column]) === true;
  const blocks = [];
  for (let row = 0; row + 1 < grid.rows; row += 1) {
    for (let column = 0; column + 1 < grid.columns; column += 1) {
      let square = true;
      let ringClear = true;
      for (let dy = -1; dy <= 2; dy += 1) {
        for (let dx = -1; dx <= 2; dx += 1) {
          const inside = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
          const solid = solidAt(column + dx, row + dy);
          if (inside && !solid) square = false;
          if (!inside && solid) ringClear = false;
        }
      }
      if (!square || !ringClear) continue;
      const x = (column + 1) * grid.tileSize - grid.width / 2;
      const y = (row + 1) * grid.tileSize - grid.height / 2;
      blocks.push({ column, row, x, y, width: 2 * grid.tileSize, height: 2 * grid.tileSize });
    }
  }
  return blocks.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
}
