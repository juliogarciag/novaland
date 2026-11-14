/* global window */
/**
 * V6: what the browser keeps alive depends on the camera, not on the size
 * of the world. A dev build plays a generated 400x300 map
 * (`VITE_GENERATED_MAP=400x300`: 120,000 tiles in 130 chunks, 100 times the
 * world's area) next to the world itself, in the same window, and the
 * script counts what Phaser holds: ground tilemaps, their tiles, standing
 * images, and every game object of the scene.
 *
 * - On the big map only the chunks near the camera are drawn, a few of 130,
 *   and no more tile images than the 40x30 world keeps alive.
 * - Walking for ten seconds changes which chunks are drawn and never how
 *   many: old ones are dropped as new ones are built.
 * - A camera that shows more (zoomed out) draws more chunks; the map's size
 *   never enters into it.
 * - Nothing is missing: with the camera in the middle of the big map every
 *   pixel of the screen is terrain, also while walking and zoomed out.
 */
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { PLAY_VIEWPORT, openGame, startClient } from './browser.mjs';
import { PROOF, check, summarize, writeProof } from './lib.mjs';

const WORLD_PORT = 5953;
const BIG_PORT = 5954;
const BIG_MAP = '400x300';
/** The page's background (index.html and the Phaser config): a pixel of this colour is a place where no terrain was drawn. */
const BACKGROUND = [0x0b, 0x0f, 0x14];
const results = [];
const report = {};
const errors = [];
const servers = [];
let browser;
try {
  servers.push(await startClient({ port: WORLD_PORT }));
  servers.push(await startClient({ port: BIG_PORT, env: { VITE_GENERATED_MAP: BIG_MAP } }));
  browser = await chromium.launch();
  const world = await openGame(browser, { port: WORLD_PORT, viewport: PLAY_VIEWPORT, errors });
  const big = await openGame(browser, { port: BIG_PORT, viewport: PLAY_VIEWPORT, errors });

  const worldAlive = await alive(world);
  const bigAlive = await alive(big);
  report.world = worldAlive;
  report.big = { atStart: bigAlive };
  results.push(check(`the generated map is ${BIG_MAP}: 100 times the world's tiles`, bigAlive.map.tiles === 100 * worldAlive.map.tiles && bigAlive.map.bounds.width === 400 && bigAlive.map.bounds.height === 300, `${bigAlive.map.tiles} tiles in ${bigAlive.map.chunks} chunks, ${bigAlive.map.standingTiles} trees and rocks; the world has ${worldAlive.map.tiles} tiles in ${worldAlive.map.chunks} chunks, ${worldAlive.map.standingTiles} trees and rocks`));
  results.push(check('on the big map only the chunks near the camera are drawn', bigAlive.chunksDrawn.length <= 9 && bigAlive.chunksDrawn.length < bigAlive.map.chunks / 10, `${bigAlive.chunksDrawn.length} of ${bigAlive.map.chunks} chunks: ${bigAlive.chunksDrawn.join(' ')}`));
  results.push(check('ground tiles alive are the drawn chunks, not the map', bigAlive.groundTiles === bigAlive.chunksDrawn.length * bigAlive.chunkSize ** 2 && bigAlive.groundTiles < bigAlive.map.tiles / 10, `${bigAlive.groundTiles} of ${bigAlive.map.tiles}`));
  results.push(check('standing images alive are the trees and rocks of the drawn chunks, not of the map', bigAlive.standingImages === bigAlive.standingTilesInDrawnChunks && bigAlive.standingImages < bigAlive.map.standingTiles / 10, `${bigAlive.standingImages} of ${bigAlive.map.standingTiles}`));
  results.push(check('the big map keeps no more tile images alive than the 40x30 world does in the same window', bigAlive.standingImages <= worldAlive.standingImages && bigAlive.sceneObjects <= worldAlive.sceneObjects, `images ${bigAlive.standingImages} against ${worldAlive.standingImages}; all game objects of the scene ${bigAlive.sceneObjects} against ${worldAlive.sceneObjects}`));
  results.push(check('what Phaser holds is what the report says: one tilemap layer per drawn chunk and one image per standing tile in them', bigAlive.phaserLayers === bigAlive.chunksDrawn.length && bigAlive.phaserImages === bigAlive.standingImages && worldAlive.phaserLayers === worldAlive.chunksDrawn.length && worldAlive.phaserImages === worldAlive.standingImages, `big: ${bigAlive.phaserLayers} layers, ${bigAlive.phaserImages} images; world: ${worldAlive.phaserLayers} layers, ${worldAlive.phaserImages} images`));
  results.push(check('every pixel of the screen is terrain: nothing near the camera was left out', backgroundPixels(await big.screenshot({ path: path.join(PROOF, '06-big-map-start.png') })) === 0));

  // ---- Walk for ten seconds: the drawn chunks follow the camera, their number does not grow ----
  const walk = { chunkSets: new Set(), mostChunks: 0, mostImages: 0, mostObjects: 0, backgroundPixels: 0, samples: 0 };
  const before = await alive(big);
  for (const key of ['KeyD', 'KeyS']) {
    await big.keyboard.down(key);
    for (let sample = 0; sample < 10; sample += 1) {
      await big.waitForTimeout(500);
      const now = await alive(big);
      walk.chunkSets.add(now.chunksDrawn.join(' '));
      walk.mostChunks = Math.max(walk.mostChunks, now.chunksDrawn.length);
      walk.mostImages = Math.max(walk.mostImages, now.standingImages);
      walk.mostObjects = Math.max(walk.mostObjects, now.sceneObjects);
      walk.backgroundPixels += backgroundPixels(await big.screenshot());
      walk.samples += 1;
    }
    await big.keyboard.up(key);
  }
  const after = await alive(big);
  await big.screenshot({ path: path.join(PROOF, '06-big-map-after-walking.png') });
  const moved = Math.hypot(after.player.x - before.player.x, after.player.y - before.player.y);
  report.big.walk = { ...walk, chunkSets: [...walk.chunkSets], movedMetres: moved, after };
  results.push(check('walking changed which chunks are drawn', moved > bigAlive.chunkSize / 2 && walk.chunkSets.size > 1 && after.chunksDrawn.join() !== before.chunksDrawn.join(), `walked ${moved.toFixed(1)} m; ${walk.chunkSets.size} different sets of chunks; now ${after.chunksDrawn.join(' ')}`));
  results.push(check('and never how many: chunks behind the camera were dropped as new ones were built', walk.mostChunks <= 9 && walk.mostObjects <= worldAlive.sceneObjects, `at most ${walk.mostChunks} chunks, ${walk.mostImages} standing images, ${walk.mostObjects} game objects in ${walk.samples} samples`));
  results.push(check('no terrain was missing on screen at any point of the walk', walk.backgroundPixels === 0, `${walk.backgroundPixels} background pixels in ${walk.samples} screenshots`));

  // ---- A camera that shows more draws more: it is the camera that decides ----
  await big.evaluate(() => window.__novaland.game.scene.getScene('world').cameras.main.setZoom(1));
  await big.waitForTimeout(300);
  const zoomedOut = await alive(big);
  report.big.zoomedOut = zoomedOut;
  results.push(check('zoomed out to three times as much world on screen, more chunks are drawn, still a fraction of the map', zoomedOut.camera.visibleMetres.width === 3 * after.camera.visibleMetres.width && zoomedOut.chunksDrawn.length > after.chunksDrawn.length && zoomedOut.chunksDrawn.length <= 20 && zoomedOut.standingImages === zoomedOut.standingTilesInDrawnChunks, `${after.camera.visibleMetres.width} m across: ${after.chunksDrawn.length} chunks; ${zoomedOut.camera.visibleMetres.width} m across: ${zoomedOut.chunksDrawn.length} chunks, of ${zoomedOut.map.chunks}`));
  results.push(check('zoomed out, every pixel of the screen is still terrain', backgroundPixels(await big.screenshot({ path: path.join(PROOF, '06-big-map-zoomed-out.png') })) === 0));
  results.push(check('no page errors', errors.length === 0, errors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  for (const server of servers) server.stop();
}
report.results = results;
writeProof('06-big-map.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** What the map holds, what the terrain report says is drawn, and what Phaser really has in the world scene. */
function alive(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const terrain = api.terrain();
    const standing = new Set(api.defs.filter((def) => def.standingSprite).map((def) => def.id));
    const standingIn = (chunk) => chunk.defIds.reduce((count, defId) => count + (standing.has(defId) ? 1 : 0), 0);
    const drawn = new Set(terrain.chunksDrawn);
    const scene = api.game.scene.getScene('world');
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot).components.Position;
    return {
      map: {
        bounds: api.tiles.bounds,
        chunks: api.tiles.chunks.length,
        tiles: api.tiles.chunks.reduce((count, chunk) => count + chunk.defIds.reduce((tiles, defId) => tiles + (defId === 0 ? 0 : 1), 0), 0),
        standingTiles: api.tiles.chunks.reduce((count, chunk) => count + standingIn(chunk), 0),
      },
      chunkSize: api.chunkSize,
      chunksDrawn: terrain.chunksDrawn,
      groundTiles: terrain.groundTiles,
      standingImages: terrain.standingImages,
      standingTilesInDrawnChunks: api.tiles.chunks.filter((chunk) => drawn.has(`${chunk.column},${chunk.row}`)).reduce((count, chunk) => count + standingIn(chunk), 0),
      sceneObjects: scene.children.list.length,
      phaserLayers: scene.children.list.filter((child) => child.type === 'TilemapLayer').length,
      phaserImages: scene.children.list.filter((child) => child.type === 'Image').length,
      camera: api.camera(),
      player: { x: player.x, y: player.y },
    };
  });
}

/** Pixels of a screenshot that show the page background: places where no terrain was drawn. */
function backgroundPixels(png) {
  const { data } = PNG.sync.read(png);
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] === BACKGROUND[0] && data[index + 1] === BACKGROUND[1] && data[index + 2] === BACKGROUND[2]) count += 1;
  }
  return count;
}
