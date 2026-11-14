/* global window */
/**
 * V3: the trees in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium and walks the player around a free-standing 2x2 clump of trees:
 * south of it (in front), west of it (beside) and north of it (behind).
 *
 * At each stop it proves the draw order twice. From the Phaser display list:
 * every tree image is sorted against the player by bottom edge, the same
 * rule entities use among themselves. And from the pixels of a screenshot:
 * every pixel of the player's sprite shows either the player or a tree,
 * exactly as that order says, so a hidden pixel really is hidden and a
 * visible one really is visible.
 *
 * It also checks that there is one tree image per tree tile, standing on the
 * bottom centre of its tile with grass under it; that the sim is untouched
 * (a tree still stops the player at the tile's faces); and that trees stay
 * crisp at several whole-number zooms: every texture pixel is one flat block
 * of zoom x zoom screen pixels.
 *
 * Expected numbers come from the level grid, the defs and the camera, read
 * through the debug API. Screenshots are the proof.
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5336;
/** CSS pixels; the page is opened at a pixel ratio of 1 so screen pixels, device pixels and CSS pixels agree. */
const VIEWPORT = { width: 960, height: 720 };
const OTHER_VIEWPORTS = [
  { width: 640, height: 480 },
  { width: 1920, height: 1080 },
];
const PHASER_NEAREST_SCALE_MODE = 1; // Phaser.ScaleModes.NEAREST
/** The HUD text sits in this corner of the screen, in CSS pixels; tree checks stay out of it. */
const HUD_CORNER = { width: 460, height: 90 };
const results = [];
const report = { stops: [] };
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
  await page.waitForFunction(() => window.__novaland && window.__novaland.sim.tick > 10 && window.__novaland.camera(), null, { timeout: 15000 });

  // ---- Content the expectations are derived from ----
  const content = await page.evaluate(() => {
    const api = window.__novaland;
    const tiles = api.defs.filter((def) => typeof def.solid === 'boolean');
    const playerEntity = api.snapshot().entities.find((entity) => entity.components.Player);
    const avatar = api.defs.find((def) => def.id === playerEntity.components.DefRef.id);
    return { grid: api.grid, tiles, avatar, pixelsPerMetre: api.pixelsPerMetre };
  });
  const { grid, tiles, avatar, pixelsPerMetre: PIXELS_PER_METRE } = content;
  const tree = tiles.find((def) => def.name === 'tree');
  const TREE = tree.standing;
  const RADIUS = avatar.radius;
  const tileCentre = ({ column, row }) => ({ x: (column + 0.5) * grid.tileSize - grid.width / 2, y: (row + 0.5) * grid.tileSize - grid.height / 2 });
  const treeTiles = [];
  grid.defIds.forEach((defIds, row) => defIds.forEach((defId, column) => defId === tree.id && treeTiles.push({ column, row })));
  const clump = nearestTwoByTwoClump(grid, tree.id, tileCentre(await page.evaluate(() => window.__novaland.level.spawn)));
  report.content = { tree, avatar: avatar.name, treeTiles: treeTiles.length, clump, freeStandingSingleTrees: freeStandingSingleTrees(grid, tree.id).length };
  results.push(check('the tree def is unchanged for the sim: id 202, solid', tree.id === 202 && tree.solid === true));
  results.push(check('the tree def carries a standing sprite that stands on grass', TREE && TREE.key === 'tree' && tiles.find((def) => def.id === TREE.groundDefId)?.name === 'grass', JSON.stringify(TREE)));
  results.push(check('the level has a free-standing 2x2 clump of trees to walk around', clump !== undefined, JSON.stringify(clump)));

  const treeSheet = await servedPng(page, `sprites/${TREE.key}.png`);
  const avatarSheet = await servedPng(page, `sprites/${avatar.sprite.key}.png`);
  results.push(check('the tree sheet is served as a PNG of `variants` frames side by side', treeSheet.ok && treeSheet.png.width === TREE.frameWidth * TREE.variants && treeSheet.png.height === TREE.frameHeight, `${treeSheet.status} ${treeSheet.contentType} ${treeSheet.png.width}x${treeSheet.png.height}`));

  const loaded = await page.evaluate((key) => {
    const { game } = window.__novaland;
    return { exists: game.textures.exists(key), frames: game.textures.get(key).frameTotal - 1, scaleMode: game.textures.get(key).source[0].scaleMode, pixelArt: game.config.pixelArt }; // frameTotal counts the __BASE frame
  }, TREE.key);
  results.push(check('Phaser loaded the tree sheet with one frame per variant', loaded.exists && loaded.frames === TREE.variants, `${loaded.frames} frames`));
  results.push(check('the tree sheet is drawn with nearest-neighbour filtering', loaded.scaleMode === PHASER_NEAREST_SCALE_MODE && loaded.pixelArt === true, `scaleMode ${loaded.scaleMode}`));

  /** Sim state, the camera and the drawn objects, read between two frames. */
  const state = () =>
    page.evaluate((treeKey) => {
      const api = window.__novaland;
      const snapshot = api.snapshot();
      const playerEntity = snapshot.entities.find((entity) => entity.components.Player);
      const objects = api.game.scene.getScene('world').children.list;
      const spriteIndex = objects.findIndex((object) => object.type === 'Sprite');
      const sprite = objects[spriteIndex];
      const terrain = objects.find((object) => object.type === 'TilemapLayer');
      return {
        camera: api.camera(),
        x: playerEntity.components.Position.x,
        y: playerEntity.components.Position.y,
        // `drawIndex` is the place in the display list as Phaser sorted it for the last frame: later is drawn on top.
        sprite: { drawIndex: spriteIndex, x: sprite.x, y: sprite.y, depth: sprite.depth, frame: Number(sprite.frame.name), originX: sprite.originX, originY: sprite.originY, width: sprite.displayWidth, height: sprite.displayHeight },
        trees: objects.flatMap((object, drawIndex) => (object.type === 'Image' && object.texture.key === treeKey ? [{ drawIndex, x: object.x, y: object.y, depth: object.depth, frame: Number(object.frame.name), originX: object.originX, originY: object.originY, scaleX: object.scaleX, scaleY: object.scaleY, width: object.displayWidth, height: object.displayHeight }] : [])),
        terrain: { drawIndex: objects.indexOf(terrain), depth: terrain.depth, tileIndexRows: terrain.layer.data.map((row) => row.map((tile) => tile.index)) },
      };
    }, TREE.key);
  /** Holds a key until the sim state satisfies `arrived`, then lets the player come to rest. */
  const walkUntil = async (key, arrived, timeoutMs = 8000) => {
    await page.keyboard.down(key);
    const deadline = Date.now() + timeoutMs;
    let reached = false;
    while (Date.now() < deadline && !(reached = arrived(await state()))) await page.waitForTimeout(10);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
    return reached;
  };
  const push = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
  };
  const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
  const onScreen = (sample, worldX, worldY) => ({ x: (worldX - sample.camera.worldView.x) * sample.camera.zoom, y: (worldY - sample.camera.worldView.y) * sample.camera.zoom });
  /** A screenshot of a few metres around a point, for the proof folder. */
  const closeUp = async (name, sample, centreMetres, sizeMetres = { width: 7, height: 7 }) => {
    const centre = onScreen(sample, centreMetres.x * PIXELS_PER_METRE, centreMetres.y * PIXELS_PER_METRE);
    const width = sizeMetres.width * PIXELS_PER_METRE * sample.camera.zoom;
    const height = sizeMetres.height * PIXELS_PER_METRE * sample.camera.zoom;
    const x = Math.max(0, Math.min(Math.round(centre.x - width / 2), sample.camera.width - width));
    const y = Math.max(0, Math.min(Math.round(centre.y - height / 2), sample.camera.height - height));
    await page.screenshot({ path: path.join(PROOF, name), clip: { x, y, width, height } });
  };

  // ---- One image per tree tile, standing on its bottom edge, grass underneath ----
  const initial = await state();
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-forest-edge-at-spawn.png') });
  const treeImageAt = (sample, tile) => {
    const centre = tileCentre(tile);
    return sample.trees.find((image) => near(image.x, centre.x * PIXELS_PER_METRE) && near(image.y, (centre.y + grid.tileSize / 2) * PIXELS_PER_METRE));
  };
  results.push(check(`there is one tree image per tree tile (${treeTiles.length})`, initial.trees.length === treeTiles.length && treeTiles.every((tile) => treeImageAt(initial, tile)), `${initial.trees.length} images`));
  results.push(check("every tree image stands on its tile's bottom centre and is sorted by that bottom edge", initial.trees.every((image) => image.originX === 0.5 && image.originY === 1 && image.depth === image.y)));
  results.push(check('every tree image is drawn at one texture pixel per world pixel, on whole pixels', initial.trees.every((image) => image.scaleX === PIXELS_PER_METRE / TREE.pixelsPerMetre && image.scaleY === image.scaleX && image.width === TREE.frameWidth && image.height === TREE.frameHeight && Number.isInteger(image.x - image.width / 2) && Number.isInteger(image.y))));
  const variantsUsed = new Set(initial.trees.map((image) => image.frame));
  results.push(check('every variant of the sheet is used, and only those', variantsUsed.size === TREE.variants && [...variantsUsed].every((frame) => Number.isInteger(frame) && frame >= 0 && frame < TREE.variants), [...variantsUsed].sort().join(',')));
  const tileIndexOfDef = new Map(tiles.map((def, index) => [def.id, index]));
  const groundAsExpected = grid.defIds.every((defIds, row) => defIds.every((defId, column) => initial.terrain.tileIndexRows[row][column] === tileIndexOfDef.get(defId === tree.id ? TREE.groundDefId : defId)));
  results.push(check('the ground layer draws grass under every tree and every other tile as before', groundAsExpected));
  results.push(check('the ground layer is below every tree and the player', initial.terrain.drawIndex === 0 && initial.trees.every((image) => image.depth > initial.terrain.depth) && initial.sprite.depth > initial.terrain.depth));
  const treeDrawOrder = [...initial.trees].sort((first, second) => first.drawIndex - second.drawIndex);
  results.push(check('trees further south are drawn over trees further north', treeDrawOrder.every((image, index) => index === 0 || image.y >= treeDrawOrder[index - 1].y)));

  // ---- Walk around the clump ----
  const southWestTree = { column: clump.column, row: clump.row + 1 };
  const northWestTree = { column: clump.column, row: clump.row };
  const southWest = tileCentre(southWestTree);
  const northWest = tileCentre(northWestTree);
  const half = grid.tileSize / 2;
  const clear = RADIUS + 0.1; // far enough from a face to walk past it
  const stops = [];
  /** Records a stop: the state, a screenshot of the whole screen, and what the pixels and the display list say about the draw order. */
  const recordStop = async (name, description, expectations) => {
    const sample = await state();
    const screenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, `03-browser-${name}.png`) }));
    await closeUp(`03-browser-${name}-close-up.png`, sample, { x: clump.x, y: clump.y - 0.5 });
    const order = drawOrderAgainstTrees(sample);
    const pixels = playerPixelsOnScreen({ sample, screenshot, treeSheet: treeSheet.png, avatarSheet: avatarSheet.png, tree: TREE, avatarSprite: avatar.sprite });
    stops.push(sample);
    report.stops.push({ name, description, player: { x: sample.x, y: sample.y, bottomEdge: sample.y + RADIUS }, spriteDepth: sample.sprite.depth, overlappingTrees: order.overlapping, pixels: pixels.summary });
    results.push(check(`${name}: the player's depth is the bottom edge of its body in pixels`, near(sample.sprite.depth, (sample.y + RADIUS) * PIXELS_PER_METRE)));
    results.push(check(`${name}: every tree overlapping the player is drawn on the side its bottom edge says`, order.overlapping.length > 0 && order.wrong.length === 0, `${order.overlapping.length} overlapping tree image(s): ${order.overlapping.map((entry) => `${entry.relation} the tree at depth ${entry.treeDepth}`).join(', ')}`));
    results.push(check(`${name}: on screen, every pixel of the player's sprite is the player or a tree, as that order says`, pixels.summary.wrong === 0, JSON.stringify(pixels.summary)));
    for (const expectation of expectations({ sample, order, pixels })) results.push(expectation);
    return sample;
  };
  const relationTo = (order, tile) => order.overlapping.find((entry) => near(entry.treeDepth, (tileCentre(tile).y + half) * PIXELS_PER_METRE))?.relation;

  // In front: south of the clump, pushed against the south face of its south-west tree.
  results.push(check('walked east along the path to the column of the clump', await walkUntil('KeyD', (sample) => sample.x >= southWest.x)));
  await push('KeyW', 1500);
  await recordStop('2-in-front', 'south of the clump, against its south face', ({ sample, order, pixels }) => [
    check('2-in-front: the sim stopped the player at the south face of the tree tile, as before', near(sample.y, southWest.y + half + RADIUS, 0.05) && Math.abs(sample.x - southWest.x) < half, `y=${sample.y.toFixed(3)}, face + radius at ${(southWest.y + half + RADIUS).toFixed(3)}`),
    check('2-in-front: the player is in front of the tree it stands under', relationTo(order, southWestTree) === 'in front of', relationTo(order, southWestTree)),
    check('2-in-front: the whole sprite is visible although it overlaps the tree', pixels.summary.hiddenByATree === 0 && pixels.summary.visible > 100, `${pixels.summary.visible} visible, ${pixels.summary.hiddenByATree} hidden`),
  ]);

  // Beside: west of the clump, level with its south-west tree, pushed against the west face.
  results.push(check('walked west past the corner of the clump', await walkUntil('KeyA', (sample) => sample.x <= southWest.x - half - clear)));
  results.push(check('walked north until level with the south-west tree', await walkUntil('KeyW', (sample) => sample.y <= southWest.y)));
  await push('KeyD', 600);
  await recordStop('3-beside', 'west of the clump, level with its south-west tree', ({ sample, order, pixels }) => [
    check('3-beside: the sim stopped the player at the west face of the tree tile, as before', near(sample.x, southWest.x - half - RADIUS, 0.05) && Math.abs(sample.y - southWest.y) < half, `x=${sample.x.toFixed(3)}, face - radius at ${(southWest.x - half - RADIUS).toFixed(3)}`),
    check("3-beside: the tree's foot is further south than the player's, so the tree is in front of the player", sample.y + RADIUS < southWest.y + half && relationTo(order, southWestTree) === 'behind', relationTo(order, southWestTree)),
    check('3-beside: the player is in front of the tree to the north-east, whose foot is further north', relationTo(order, northWestTree) === 'in front of', relationTo(order, northWestTree)),
    check('3-beside: the canopy overhanging to the west covers a few pixels of the player, the rest is visible', pixels.summary.hiddenByATree > 0 && pixels.summary.visible > pixels.summary.hiddenByATree, `${pixels.summary.visible} visible, ${pixels.summary.hiddenByATree} hidden`),
  ]);

  // Behind: north of the clump, pushed against the north face of its north-west tree.
  results.push(check('walked north past the corner of the clump', await walkUntil('KeyW', (sample) => sample.y <= northWest.y - half - clear)));
  results.push(check('walked east to the column of the north-west tree', await walkUntil('KeyD', (sample) => sample.x >= northWest.x)));
  await push('KeyS', 1500);
  const behind = await recordStop('4-behind', 'north of the clump, against its north face', ({ sample, order, pixels }) => [
    check('4-behind: the sim stopped the player at the north face of the tree tile, as before', near(sample.y, northWest.y - half - RADIUS, 0.05) && Math.abs(sample.x - northWest.x) < half, `y=${sample.y.toFixed(3)}, face - radius at ${(northWest.y - half - RADIUS).toFixed(3)}`),
    check('4-behind: the player is behind the tree it stands north of', relationTo(order, northWestTree) === 'behind', relationTo(order, northWestTree)),
    check('4-behind: the canopy hides the lower part of the player and the head shows above it', pixels.summary.hiddenByATree > 60 && pixels.summary.visible > 20 && pixels.rowsHidden.length > 0 && pixels.rowsVisible.length > 0 && Math.max(...pixels.rowsVisible) < Math.max(...pixels.rowsHidden), `${pixels.summary.hiddenByATree} hidden (sprite rows ${Math.min(...pixels.rowsHidden)}-${Math.max(...pixels.rowsHidden)}), ${pixels.summary.visible} visible (rows ${Math.min(...pixels.rowsVisible)}-${Math.max(...pixels.rowsVisible)})`),
  ]);
  results.push(check('the three stops saw the player both in front of and behind the same clump', new Set(report.stops.flatMap((stop) => stop.overlappingTrees.map((entry) => entry.relation))).size === 2));

  // ---- A tree with open ground on three sides, for the proof folder ----
  // The level has no tree with open ground all around it; the nearest thing is one that sticks out of the forest edge.
  const jutting = nearestJuttingTree(grid, tree.id, { x: behind.x, y: behind.y });
  report.juttingTree = jutting;
  if (jutting) {
    const target = tileCentre({ column: jutting.column, row: jutting.row + 2 });
    const vertical = target.y < behind.y ? ['KeyW', (sample) => sample.y <= target.y] : ['KeyS', (sample) => sample.y >= target.y];
    const horizontal = target.x < behind.x ? ['KeyA', (sample) => sample.x <= target.x] : ['KeyD', (sample) => sample.x >= target.x];
    await walkUntil(...vertical);
    await walkUntil(...horizontal);
    const sample = await state();
    await page.screenshot({ path: path.join(PROOF, '03-browser-5-tree-at-the-forest-edge.png') });
    await closeUp('03-browser-5-tree-at-the-forest-edge-close-up.png', sample, tileCentre(jutting), { width: 9, height: 7 });
    results.push(check('walked to the tree that sticks out of the forest edge', Math.hypot(sample.x - target.x, sample.y - target.y) < 1.5, `(${sample.x.toFixed(2)}, ${sample.y.toFixed(2)})`));
  }

  // ---- Crisp at every whole-number zoom, looked at from the forest edge where many trees are on screen ----
  const zooms = [];
  for (const viewport of [VIEWPORT, ...OTHER_VIEWPORTS]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction((width) => window.__novaland.camera().width === width, viewport.width, { timeout: 5000 });
    await page.waitForTimeout(300);
    const sample = await state();
    const name = `03-browser-6-zoom-${sample.camera.zoom}x.png`;
    const screenshot = PNG.sync.read(await page.screenshot({ path: path.join(PROOF, name) }));
    const crisp = treesAreCrisp({ sample, screenshot, treeSheet: treeSheet.png, tree: TREE });
    zooms.push({ viewport, zoom: sample.camera.zoom, ...crisp.summary });
    results.push(check(`${viewport.width}x${viewport.height}: the camera zoom is a whole number`, Number.isInteger(sample.camera.zoom) && sample.camera.zoom >= 1, `zoom ${sample.camera.zoom}`));
    results.push(check(`${viewport.width}x${viewport.height}: every texture pixel of every tree checked is one flat ${sample.camera.zoom}x${sample.camera.zoom} block of screen pixels`, crisp.summary.treesChecked >= 4 && crisp.summary.blocksNotFlat === 0 && crisp.summary.treesOffTheScreenGrid === 0, JSON.stringify(crisp.summary)));
    results.push(check(`${viewport.width}x${viewport.height}: those trees show the sheet's own colours, unblended`, crisp.summary.sheetPixelsWrong === 0 && crisp.summary.sheetPixelsCompared > 500 && crisp.summary.sheetColoursSeen >= 6, `${crisp.summary.sheetPixelsCompared} pixels compared, ${crisp.summary.sheetColoursSeen} sheet colours seen`));
  }
  report.zooms = zooms;
  results.push(check('the trees were checked at more than one zoom', new Set(zooms.map((entry) => entry.zoom)).size >= 2, zooms.map((entry) => `${entry.zoom}x`).join(', ')));
  await page.setViewportSize(VIEWPORT);
  await page.waitForFunction((width) => window.__novaland.camera().width === width, VIEWPORT.width, { timeout: 5000 });

  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

async function servedPng(page, relativeUrl) {
  const response = await page.request.get(`http://localhost:${PORT}/${relativeUrl}`);
  const contentType = response.headers()['content-type'] ?? '';
  const ok = response.status() === 200 && contentType.includes('image/png');
  return { ok, status: response.status(), contentType, png: ok ? PNG.sync.read(await response.body()) : { width: 0, height: 0, data: Buffer.alloc(0) } };
}

function rgbaAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return { colour: 'outside', alpha: 0 };
  const offset = (y * png.width + x) * 4;
  return { colour: `${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]}`, alpha: png.data[offset + 3] };
}

function overlaps(first, second) {
  return first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;
}

/** The world pixels a drawn object covers. */
function rectangleOf(image) {
  return { left: image.x - image.width * image.originX, top: image.y - image.height * image.originY, right: image.x + image.width * (1 - image.originX), bottom: image.y + image.height * (1 - image.originY) };
}

/**
 * For every tree image whose rectangle overlaps the player's sprite: whether the display list draws the player in
 * front of it or behind it, and whether that agrees with the bottom edges (the further south, the more in front).
 */
function drawOrderAgainstTrees(sample) {
  const playerRectangle = rectangleOf(sample.sprite);
  const overlapping = sample.trees
    .filter((image) => overlaps(playerRectangle, rectangleOf(image)))
    .map((image) => ({ treeDepth: image.depth, relation: sample.sprite.drawIndex > image.drawIndex ? 'in front of' : 'behind', expected: sample.sprite.depth > image.depth ? 'in front of' : 'behind' }));
  return { overlapping, wrong: overlapping.filter((entry) => entry.relation !== entry.expected) };
}

/**
 * Compares the screenshot with what the draw order says for every opaque texture pixel of the player's current
 * frame. The pixel is expected to show a tree where a tree drawn after the player is opaque there, and the player's
 * own colour where every such tree is see-through there. Pixels under a tree's soft shadow, and pixels where the
 * player's texel straddles two tree texels that disagree, are skipped: their colour is a blend or a coin toss.
 */
function playerPixelsOnScreen({ sample, screenshot, treeSheet, avatarSheet, tree, avatarSprite }) {
  const { sprite, camera } = sample;
  const spriteLeft = sprite.x - sprite.width * sprite.originX;
  const spriteTop = sprite.y - sprite.height * sprite.originY;
  const frameColumn = sprite.frame % (avatarSheet.width / avatarSprite.frameWidth);
  const frameRow = Math.floor(sprite.frame / (avatarSheet.width / avatarSprite.frameWidth));
  const treesInFront = sample.trees.filter((image) => image.drawIndex > sprite.drawIndex);
  const summary = { visible: 0, hiddenByATree: 0, skipped: 0, wrong: 0 };
  const rowsHidden = [];
  const rowsVisible = [];
  for (let row = 0; row < avatarSprite.frameHeight; row += 1) {
    for (let column = 0; column < avatarSprite.frameWidth; column += 1) {
      const own = rgbaAt(avatarSheet, frameColumn * avatarSprite.frameWidth + column, frameRow * avatarSprite.frameHeight + row);
      if (own.alpha !== 255) continue;
      const worldX = spriteLeft + column + 0.5;
      const worldY = spriteTop + row + 0.5;
      const seen = rgbaAt(screenshot, Math.floor((worldX - camera.worldView.x) * camera.zoom), Math.floor((worldY - camera.worldView.y) * camera.zoom));
      if (seen.colour === 'outside') continue;
      // The player is not on whole world pixels and the trees are, so the point may land on either of two tree texels
      // per axis. It is decidable only when all of them agree: opaque everywhere, or see-through everywhere.
      const around = [-0.25, 0.25].flatMap((nudgeX) => [-0.25, 0.25].map((nudgeY) => treesCoveringPoint({ trees: treesInFront, treeSheet, tree, worldX: worldX + nudgeX, worldY: worldY + nudgeY })));
      const covering = new Set(around.flatMap((cover) => cover.colours));
      const undecidable = around.some((cover) => cover.kind === 'shadow') || new Set(around.map((cover) => cover.kind)).size > 1;
      if (undecidable) {
        summary.skipped += 1;
      } else if (covering.size > 0) {
        if (covering.has(seen.colour)) {
          summary.hiddenByATree += 1;
          rowsHidden.push(row);
        } else summary.wrong += 1;
      } else if (seen.colour === own.colour) {
        summary.visible += 1;
        rowsVisible.push(row);
      } else summary.wrong += 1;
    }
  }
  return { summary, rowsHidden, rowsVisible };
}

/**
 * What the trees put over a world point: `opaque` with the colours of every tree texel there, `shadow` when a tree
 * is partly see-through there (the colour is then a blend), or `clear`.
 */
function treesCoveringPoint({ trees, treeSheet, tree, worldX, worldY }) {
  const colours = [];
  let shadow = false;
  for (const image of trees) {
    const { left, top } = rectangleOf(image);
    const texelX = Math.floor(worldX - left);
    const texelY = Math.floor(worldY - top);
    if (texelX < 0 || texelY < 0 || texelX >= tree.frameWidth || texelY >= tree.frameHeight) continue;
    const texel = rgbaAt(treeSheet, image.frame * tree.frameWidth + texelX, texelY);
    if (texel.alpha === 255) colours.push(texel.colour);
    else if (texel.alpha > 0) shadow = true;
  }
  return { kind: shadow ? 'shadow' : colours.length > 0 ? 'opaque' : 'clear', colours };
}

/**
 * For every tree image fully on screen, away from the HUD corner and from the player: the image starts on a whole
 * screen pixel, every texture pixel covers one flat zoom x zoom block, and where the tree is opaque and no tree
 * drawn after it reaches, the block is exactly the sheet's colour. Trees and tiles all sit on whole world pixels,
 * so blocks stay flat where trees overlap.
 */
function treesAreCrisp({ sample, screenshot, treeSheet, tree }) {
  const { camera, sprite } = sample;
  const zoom = camera.zoom;
  const playerRectangle = rectangleOf(sprite);
  const padded = { left: playerRectangle.left - 1, top: playerRectangle.top - 1, right: playerRectangle.right + 1, bottom: playerRectangle.bottom + 1 };
  const summary = { treesChecked: 0, treesOffTheScreenGrid: 0, blocksChecked: 0, blocksNotFlat: 0, sheetPixelsCompared: 0, sheetPixelsWrong: 0, sheetColoursSeen: 0 };
  const sheetColoursSeen = new Set();
  for (const image of sample.trees) {
    const rectangle = rectangleOf(image);
    // The camera snaps its view to device pixels, so these are whole numbers but for floating point dust.
    const exactLeft = (rectangle.left - camera.worldView.x) * zoom;
    const exactTop = (rectangle.top - camera.worldView.y) * zoom;
    const screenLeft = Math.round(exactLeft);
    const screenTop = Math.round(exactTop);
    const fullyOnScreen = screenLeft >= 0 && screenTop >= 0 && screenLeft + image.width * zoom <= screenshot.width && screenTop + image.height * zoom <= screenshot.height;
    const underTheHud = screenLeft < HUD_CORNER.width && screenTop < HUD_CORNER.height;
    if (!fullyOnScreen || underTheHud || overlaps(padded, rectangle)) continue;
    summary.treesChecked += 1;
    if (Math.abs(exactLeft - screenLeft) > 1e-6 || Math.abs(exactTop - screenTop) > 1e-6) {
      summary.treesOffTheScreenGrid += 1;
      continue;
    }
    const treesDrawnAfter = sample.trees.filter((other) => other.drawIndex > image.drawIndex);
    for (let texelY = 0; texelY < tree.frameHeight; texelY += 1) {
      for (let texelX = 0; texelX < tree.frameWidth; texelX += 1) {
        const first = rgbaAt(screenshot, screenLeft + texelX * zoom, screenTop + texelY * zoom).colour;
        let flat = true;
        for (let y = 0; y < zoom; y += 1) {
          for (let x = 0; x < zoom; x += 1) if (rgbaAt(screenshot, screenLeft + texelX * zoom + x, screenTop + texelY * zoom + y).colour !== first) flat = false;
        }
        summary.blocksChecked += 1;
        if (!flat) summary.blocksNotFlat += 1;
        const own = rgbaAt(treeSheet, image.frame * tree.frameWidth + texelX, texelY);
        const covered = treesCoveringPoint({ trees: treesDrawnAfter, treeSheet, tree, worldX: rectangle.left + texelX + 0.5, worldY: rectangle.top + texelY + 0.5 }).kind !== 'clear';
        if (own.alpha !== 255 || covered) continue;
        summary.sheetPixelsCompared += 1;
        if (first === own.colour) sheetColoursSeen.add(first);
        else summary.sheetPixelsWrong += 1;
      }
    }
  }
  summary.sheetColoursSeen = sheetColoursSeen.size;
  return { summary };
}

/** The 2x2 square of trees nearest to a point with no tree in the ring around it, as a box in metres (its centre). */
function nearestTwoByTwoClump(grid, treeDefId, point) {
  const treeAt = (column, row) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && grid.defIds[row][column] === treeDefId;
  const clumps = [];
  for (let row = 0; row + 1 < grid.rows; row += 1) {
    for (let column = 0; column + 1 < grid.columns; column += 1) {
      let square = true;
      let ringClear = true;
      for (let dy = -1; dy <= 2; dy += 1) {
        for (let dx = -1; dx <= 2; dx += 1) {
          const inside = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
          if (inside && !treeAt(column + dx, row + dy)) square = false;
          if (!inside && treeAt(column + dx, row + dy)) ringClear = false;
        }
      }
      if (!square || !ringClear) continue;
      clumps.push({ column, row, x: (column + 1) * grid.tileSize - grid.width / 2, y: (row + 1) * grid.tileSize - grid.height / 2 });
    }
  }
  return clumps.sort((first, second) => Math.hypot(first.x - point.x, first.y - point.y) - Math.hypot(second.x - point.x, second.y - point.y))[0];
}

/** Tree tiles with no tree in any of the eight tiles around them. */
function freeStandingSingleTrees(grid, treeDefId) {
  const treeAt = (column, row) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && grid.defIds[row][column] === treeDefId;
  const found = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (!treeAt(column, row)) continue;
      let alone = true;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && treeAt(column + dx, row + dy)) alone = false;
      if (alone) found.push({ column, row });
    }
  }
  return found;
}

/** The nearest tree with a tree to its north and walkable ground to its west, east and south (two tiles deep to the south). */
function nearestJuttingTree(grid, treeDefId, point) {
  const treeAt = (column, row) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && grid.defIds[row][column] === treeDefId;
  const found = [];
  for (let row = 1; row + 2 < grid.rows; row += 1) {
    for (let column = 1; column + 1 < grid.columns; column += 1) {
      const open = [-1, 0, 1].every((dx) => !treeAt(column + dx, row + 1) && !treeAt(column + dx, row + 2)) && !treeAt(column - 1, row) && !treeAt(column + 1, row);
      if (treeAt(column, row) && treeAt(column, row - 1) && open) found.push({ column, row });
    }
  }
  const centre = ({ column, row }) => ({ x: (column + 0.5) * grid.tileSize - grid.width / 2, y: (row + 0.5) * grid.tileSize - grid.height / 2 });
  return found.sort((first, second) => Math.hypot(centre(first).x - point.x, centre(first).y - point.y) - Math.hypot(centre(second).x - point.x, centre(second).y - point.y))[0];
}
