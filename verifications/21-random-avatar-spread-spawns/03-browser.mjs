/* global window */
/**
 * V3: the change in a real browser. Starts `pnpm dev`, opens the page in
 * Chromium and, through window.__novaland and the Phaser display list,
 * checks that: every avatar sheet is served and loaded with its walk
 * animations; the local player joined with an avatar the sim picked and is
 * drawn from that avatar's sheet; seating four more players (the dev-only
 * `joinAnotherSeat`, which queues plain `player/join` commands) gives five
 * players with five different avatars on five different walkable tiles
 * around the spawn, each drawn from its own sheet; the HUD says so; walking
 * the local player (keyboard) straight through a neighbour moves nobody but
 * the walker; walking on into the forest stops at the first tree face; the
 * dev J key seats a sixth player; no console errors. Screenshots are the
 * proof. Expected numbers come from the level grid, the defs and the camera,
 * read through the debug API.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, start, summarize, waitForPort, writeProof } from './lib.mjs';

const PORT = 5321;
/** CSS pixels; the page is opened at a pixel ratio of 1 so screen pixels, device pixels and CSS pixels agree. */
const VIEWPORT = { width: 960, height: 720 };
const KEY_FOR = { right: 'KeyD', down: 'KeyS', left: 'KeyA', up: 'KeyW' };
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
    const avatars = api.avatarDefIds.map((defId) => api.defs.find((def) => def.id === defId));
    const tiles = api.defs.filter((def) => typeof def.solid === 'boolean');
    return {
      grid: api.grid,
      spawnTile: api.level.spawn,
      spawn: api.tileCentre(api.grid, api.level.spawn),
      avatars: avatars.map((def) => ({ id: def.id, name: def.name, key: def.sprite.key, radius: def.radius, speed: def.speed })),
      solidTileIds: tiles.filter((tile) => tile.solid).map((tile) => tile.id),
      pixelsPerMetre: api.pixelsPerMetre,
    };
  });
  const { grid, spawnTile: SPAWN_TILE, spawn: SPAWN, avatars: AVATARS, solidTileIds, pixelsPerMetre: PIXELS_PER_METRE } = content;
  const RADIUS = AVATARS[0].radius;
  const SPEED = AVATARS[0].speed;
  const avatarById = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));
  const isSolidTile = ({ column, row }) => solidTileIds.includes(grid.defIds[row][column]);
  report.content = { ...content, grid: { columns: grid.columns, rows: grid.rows, tileSize: grid.tileSize } };
  results.push(check('the defs declare at least 8 player avatars, each with its own sprite key and the same speed and radius', AVATARS.length >= 8 && new Set(AVATARS.map((avatar) => avatar.key)).size === AVATARS.length && AVATARS.every((avatar) => avatar.speed === SPEED && avatar.radius === RADIUS), `${AVATARS.length} avatars`));

  // Every sheet is served and loaded.
  const served = [];
  for (const avatar of AVATARS) {
    const response = await page.request.get(`http://localhost:${PORT}/sprites/${avatar.key}.png`);
    served.push({ key: avatar.key, status: response.status(), type: response.headers()['content-type'] });
  }
  results.push(check('every avatar sheet is served as a PNG', served.every((entry) => entry.status === 200 && entry.type.includes('image/png')), served.map((entry) => `${entry.key}:${entry.status}`).join(' ')));
  const loaded = await page.evaluate((keys) => {
    const api = window.__novaland;
    const scene = api.game.scene.getScene('world');
    return keys.map((key) => ({
      key,
      texture: api.game.textures.exists(key),
      frames: api.game.textures.exists(key) ? api.game.textures.get(key).frameTotal : 0,
      animations: ['down', 'up', 'left', 'right'].filter((direction) => scene.anims.exists(`${key}/walk/${direction}`)).length,
    }));
  }, AVATARS.map((avatar) => avatar.key));
  results.push(check('Phaser loaded every sheet as a 16-frame texture with four walk animations', loaded.every((entry) => entry.texture && entry.frames === 16 + 1 && entry.animations === 4))); // frameTotal counts the __BASE frame
  report.loaded = loaded;

  /** Sim state, the camera and the drawn sprites, read in the same frame. */
  const state = () =>
    page.evaluate(() => {
      const api = window.__novaland;
      const snapshot = api.snapshot();
      const scene = api.game.scene.getScene('world');
      const objects = scene.children.list;
      const sprites = objects.filter((object) => object.type === 'Sprite');
      const players = snapshot.entities
        .filter((entity) => entity.components.Player)
        .map((entity) => {
          const { x, y } = entity.components.Position;
          return { eid: entity.id, slot: entity.components.Player.slot, defId: entity.components.DefRef.id, x, y, tile: api.tileAt(api.grid, x, y), intent: entity.components.MoveIntent };
        })
        .sort((a, b) => a.slot - b.slot);
      const hud = api.game.scene.getScene('hud');
      const hudText = hud && hud.children.list.find((object) => object.type === 'Text');
      return {
        tick: snapshot.tick,
        camera: api.camera(),
        players,
        sprites: sprites.map((sprite) => ({ x: sprite.x, y: sprite.y, texture: sprite.texture.key, depth: sprite.depth })),
        circleCount: objects.filter((object) => object.type === 'Arc').length,
        hud: hudText ? hudText.text : '',
      };
    });
  const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
  const ring = (tile) => Math.max(Math.abs(tile.column - SPAWN_TILE.column), Math.abs(tile.row - SPAWN_TILE.row));
  /** Where a world point in metres lands on the screen, in CSS pixels, given the camera of the same sample. */
  const onScreen = (sample, worldX, worldY) => ({
    x: (worldX * PIXELS_PER_METRE - sample.camera.worldView.x) * sample.camera.zoom,
    y: (worldY * PIXELS_PER_METRE - sample.camera.worldView.y) * sample.camera.zoom,
  });
  const spriteOf = (sample, player) => sample.sprites.find((sprite) => near(sprite.x, player.x * PIXELS_PER_METRE, 1e-6) && near(sprite.y, player.y * PIXELS_PER_METRE, 1e-6));

  // The local player alone.
  const alone = await state();
  report.steps.push({ step: 'alone', ...alone });
  const local = alone.players.find((player) => player.slot === 0);
  results.push(check('the local player joined seat 0 wearing one of the avatar defs, chosen by the sim (the join carries no avatar)', alone.players.length === 1 && local && avatarById.has(local.defId), local && avatarById.get(local.defId)?.name));
  results.push(check('the first arrival stands on the spawn tile', local && near(local.x, SPAWN.x, 1e-6) && near(local.y, SPAWN.y, 1e-6)));
  results.push(check("it is drawn as one sprite from its avatar's sheet, no flat circle", alone.sprites.length === 1 && alone.circleCount === 0 && local && alone.sprites[0].texture === avatarById.get(local.defId).key, alone.sprites[0]?.texture));
  results.push(check('the HUD names the local avatar and counts one player', local && alone.hud.includes(`you: ${avatarById.get(local.defId).name}`) && alone.hud.includes('players: 1'), alone.hud.replace(/\n/g, ' | ')));

  // Four more seats, queued in one frame: they must not race for the same seat.
  await page.evaluate(() => {
    for (let seat = 0; seat < 4; seat += 1) window.__novaland.joinAnotherSeat();
  });
  await page.waitForFunction(() => window.__novaland.snapshot().entities.filter((entity) => entity.components.Player).length === 5, null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(200);
  const five = await state();
  report.steps.push({ step: 'five', ...five });
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-five-avatars-at-spawn.png') });
  const spawnOnScreen = onScreen(five, SPAWN.x, SPAWN.y);
  const clipMetres = 7;
  const clipSize = clipMetres * PIXELS_PER_METRE * five.camera.zoom;
  await page.screenshot({ path: path.join(PROOF, '03-browser-1-five-avatars-at-spawn-zoom.png'), clip: { x: Math.round(spawnOnScreen.x - clipSize / 2), y: Math.round(spawnOnScreen.y - clipSize / 2), width: clipSize, height: clipSize } });
  results.push(check('five players are seated in slots 0-4', five.players.length === 5 && five.players.map((player) => player.slot).join(',') === '0,1,2,3,4', five.players.map((player) => player.slot).join(',')));
  results.push(check('they wear five different avatars', new Set(five.players.map((player) => player.defId)).size === 5 && five.players.every((player) => avatarById.has(player.defId)), five.players.map((player) => avatarById.get(player.defId)?.name).join(', ')));
  results.push(check('they stand on five different tiles', new Set(five.players.map((player) => `${player.tile.column},${player.tile.row}`)).size === 5, five.players.map((player) => `(${player.tile.column},${player.tile.row})`).join(' ')));
  results.push(check('every tile is walkable and touches the spawn tile (ring 0 or 1)', five.players.every((player) => player.tile && !isSolidTile(player.tile) && ring(player.tile) <= 1), five.players.map((player) => `ring ${ring(player.tile)}`).join(', ')));
  results.push(check('they are spread on both axes, not queued in a line', new Set(five.players.map((player) => player.tile.column)).size > 1 && new Set(five.players.map((player) => player.tile.row)).size > 1));
  results.push(check('each stands at the centre of its tile, so no two bodies overlap', five.players.every((player) => near(player.x, (player.tile.column + 0.5) * grid.tileSize - grid.width / 2, 1e-6) && near(player.y, (player.tile.row + 0.5) * grid.tileSize - grid.height / 2, 1e-6))));
  results.push(check("each is drawn as a sprite from its own avatar's sheet", five.sprites.length === 5 && five.circleCount === 0 && five.players.every((player) => spriteOf(five, player)?.texture === avatarById.get(player.defId).key), five.sprites.map((sprite) => sprite.texture).join(', ')));
  results.push(check('the HUD counts five players', five.hud.includes('players: 5'), five.hud.replace(/\n/g, ' | ')));

  // Walk the local player through a neighbour that shares its row or column, with open ground beyond.
  const localNow = five.players.find((player) => player.slot === 0);
  const target = pickNeighbourInLine(localNow, five.players, grid, isSolidTile);
  results.push(check('a neighbour stands straight ahead on open ground (needed for the walk-through)', target !== undefined, target && `${avatarById.get(target.player.defId).name} to the ${target.direction}`));
  if (target) {
    const distanceToCross = Math.hypot(target.player.x - localNow.x, target.player.y - localNow.y) + 1.5;
    const samples = await hold(page, state, [KEY_FOR[target.direction]], (distanceToCross / SPEED) * 1000);
    const after = await state();
    await page.screenshot({ path: path.join(PROOF, '03-browser-2-walked-through-a-neighbour.png') });
    const localAfter = after.players.find((player) => player.slot === 0);
    const targetAfter = after.players.find((player) => player.slot === target.player.slot);
    const along = (player) => target.axis === 'x' ? player.x : player.y;
    const sign = target.sign;
    const passedBy = (along(localAfter) - along(target.player)) * sign;
    results.push(check('the local player walked straight through the neighbour and is now well past it', passedBy > 2 * RADIUS, `${passedBy.toFixed(2)} m past its centre (bodies are ${(2 * RADIUS).toFixed(1)} m across)`));
    results.push(check('the neighbour was not pushed at all', near(targetAfter.x, target.player.x, 1e-9) && near(targetAfter.y, target.player.y, 1e-9)));
    const movingSamples = samples.filter((sample) => sample.players.find((player) => player.slot === 0).intent[target.axis] !== 0);
    const steps = movingSamples.slice(1).map((sample, index) => (along(sample.players.find((player) => player.slot === 0)) - along(movingSamples[index].players.find((player) => player.slot === 0))) * sign);
    results.push(check('it never slowed down or bounced while crossing (every sample moved forward)', steps.length > 5 && steps.every((step) => step > 0), `${steps.length} steps`));
    const offAxis = (player) => target.axis === 'x' ? player.y : player.x;
    results.push(check('it stayed on its line (no sideways deflection)', near(offAxis(localAfter), offAxis(localNow), 1e-6)));
    report.steps.push({ step: 'walk-through', target: target.player, direction: target.direction, localAfter, targetAfter, passedBy });

    // Keep going the same way: the forest stops the walker where the headless tests say it should.
    const wall = firstSolidTileAhead(localAfter.tile, target, grid, isSolidTile);
    if (wall) {
      const wallFace = target.axis === 'x'
        ? (wall.column + (sign > 0 ? 0 : 1)) * grid.tileSize - grid.width / 2
        : (wall.row + (sign > 0 ? 0 : 1)) * grid.tileSize - grid.height / 2;
      const expectedStop = wallFace - sign * RADIUS;
      const distanceToWall = Math.abs(expectedStop - along(localAfter));
      await hold(page, state, [KEY_FOR[target.direction]], (distanceToWall / SPEED) * 1000 + 600);
      const blocked = await state();
      await page.screenshot({ path: path.join(PROOF, '03-browser-3-blocked-by-the-forest.png') });
      const localBlocked = blocked.players.find((player) => player.slot === 0);
      const overshoot = (along(localBlocked) - expectedStop) * sign;
      results.push(check('terrain still blocks: the walker stopped against the first tree face ahead', overshoot <= 0.01 && overshoot > -0.2, `${along(localBlocked).toFixed(3)} vs face ${expectedStop.toFixed(3)}`));
      results.push(check('the other players never moved', blocked.players.filter((player) => player.slot !== 0).every((player) => { const before = five.players.find((candidate) => candidate.slot === player.slot); return near(player.x, before.x, 1e-9) && near(player.y, before.y, 1e-9); })));
      report.steps.push({ step: 'blocked', wall, expectedStop, localBlocked });
    } else {
      results.push(check('a solid tile lies ahead to prove terrain still blocks', false));
    }
  }

  // The dev J key seats one more player.
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__novaland.snapshot().entities.filter((entity) => entity.components.Player).length === 6, null, { timeout: 5000 }).catch(() => undefined);
  const six = await state();
  const sixth = six.players.find((player) => player.slot === 5);
  results.push(check('pressing J seats a sixth player in slot 5 with a valid avatar on a walkable tile', six.players.length === 6 && sixth && avatarById.has(sixth.defId) && sixth.tile && !isSolidTile(sixth.tile), sixth && `${avatarById.get(sixth.defId)?.name} at (${sixth.tile.column},${sixth.tile.row})`));
  results.push(check('all six are drawn, each from the sheet of its own avatar', six.sprites.length === 6 && six.players.every((player) => spriteOf(six, player)?.texture === avatarById.get(player.defId).key)));
  report.steps.push({ step: 'six', ...six });

  results.push(check('the camera zoom is a whole number, so every sprite pixel is crisp', Number.isInteger(five.camera.zoom) && five.camera.zoom >= 1, `zoom ${five.camera.zoom}`));
  results.push(check('no page or console errors', errors.length === 0, errors.join(' | ').slice(0, 200)));
  report.errors = errors;
} finally {
  if (browser) await browser.close();
  server.stop();
}
writeProof('03-browser.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Holds keys for `ms`, sampling the state every `every` ms, then releases and lets the sim settle. */
async function hold(page, state, keys, ms, every = 30) {
  for (const key of keys) await page.keyboard.down(key);
  const samples = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    samples.push(await state());
    await page.waitForTimeout(every);
  }
  for (const key of keys) await page.keyboard.up(key);
  await page.waitForTimeout(150);
  return samples;
}

/** The four keyboard directions as axis, sign and tile step. A function, not a const: the top-level script runs before module consts below it initialise. */
function directions() {
  return [
    { direction: 'right', axis: 'x', sign: 1, dColumn: 1, dRow: 0 },
    { direction: 'left', axis: 'x', sign: -1, dColumn: -1, dRow: 0 },
    { direction: 'down', axis: 'y', sign: 1, dColumn: 0, dRow: 1 },
    { direction: 'up', axis: 'y', sign: -1, dColumn: 0, dRow: -1 },
  ];
}

/** Another player on the local player's row or column, with at least three walkable tiles beyond it, if there is one. */
function pickNeighbourInLine(local, players, grid, isSolidTile) {
  for (const player of players) {
    if (player.slot === local.slot) continue;
    for (const candidate of directions()) {
      const steps = candidate.axis === 'x' ? player.tile.column - local.tile.column : player.tile.row - local.tile.row;
      const sameLine = candidate.axis === 'x' ? player.tile.row === local.tile.row : player.tile.column === local.tile.column;
      if (!sameLine || steps * candidate.sign <= 0) continue;
      const distance = Math.abs(steps);
      let clear = true;
      for (let step = 1; step <= distance + 3; step += 1) {
        const tile = { column: local.tile.column + candidate.dColumn * step, row: local.tile.row + candidate.dRow * step };
        if (tile.column < 0 || tile.row < 0 || tile.column >= grid.columns || tile.row >= grid.rows || isSolidTile(tile)) clear = false;
      }
      if (clear) return { player, ...candidate };
    }
  }
  return undefined;
}

/** The first solid tile from `tile` onwards in a direction, or undefined at the grid edge. */
function firstSolidTileAhead(tile, { dColumn, dRow }, grid, isSolidTile) {
  let column = tile.column + dColumn;
  let row = tile.row + dRow;
  while (column >= 0 && row >= 0 && column < grid.columns && row < grid.rows) {
    if (isSolidTile({ column, row })) return { column, row };
    column += dColumn;
    row += dRow;
  }
  return undefined;
}
