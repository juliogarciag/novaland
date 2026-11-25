/* global window, document */
/**
 * Online, against the real room server: two players with different genders
 * and hairstyles join (a character saved by the 32 px version and one with
 * the other gender and hairstyle). Each tab draws the other from the other's
 * own look texture, built from the 16x24 layers; when A turns in each of the
 * four directions, B's view of A shows that direction's idle frame. Crops of
 * B's screen are the proof.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

/** Ports no other session uses, and not the 5172 of the dev server left running for the human. */
const SERVER_PORT = 5974;
const CLIENT_PORT = 5975;
const VIEWPORT = { width: 960, height: 720 };
const DIRECTIONS = [
  ['down', 'KeyS'],
  ['up', 'KeyW'],
  ['left', 'KeyA'],
  ['right', 'KeyD'],
];
const ADA = { name: 'Ada', look: { skin: 3, hair: 2, clothes: 4, gender: 1, hairStyle: 1 } };
const BEN = { name: 'Ben', look: { skin: 1, hair: 0, clothes: 6, gender: 0, hairStyle: 0 } };
const results = [];
const report = {};
const pageErrors = [];

const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT) } });
const devServer = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let browser;
try {
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  const bootLine = portsUp && (await waitFor("the room server's boot line", { read: () => roomServer.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean }).catch(() => undefined));
  const clientReady = portsUp && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  const ready = Boolean(bootLine) && clientReady;
  results.push(check('room server and dev server up, both started by this run', ready, ready ? bootLine : `${lastLinesOf(roomServer.output)} | ${lastLinesOf(devServer.output)}`));
  if (!ready) throw new Error('nothing to open');

  browser = await chromium.launch();
  const tabA = await openTab(ADA);
  const tabB = await openTab(BEN);

  const seen = await waitFor('both tabs draw both players', {
    read: async () => ({ fromA: await drawnOf(tabA), fromB: await drawnOf(tabB) }),
    until: ({ fromA, fromB }) => fromA.length === 2 && fromB.length === 2 && [...fromA, ...fromB].every((drawn) => drawn.textureKey?.startsWith('player/look/')),
  }).catch(() => undefined);
  report.seen = seen;
  for (const [tab, drawn] of [['A', seen?.fromA], ['B', seen?.fromB]]) {
    for (const character of [ADA, BEN]) {
      const entry = drawn?.find((candidate) => candidate.name === character.name);
      const expected = `player/look/${lookKey(character.look)}`;
      results.push(check(`tab ${tab} draws ${character.name} from ${character.name}'s own look (gender ${character.look.gender}, hairstyle ${character.look.hairStyle})`, entry?.textureKey === expected && JSON.stringify(entry?.look) === JSON.stringify(character.look), entry && `${entry.textureKey}`));
    }
  }

  // Ada steps aside first, so B's crops show her clear of Ben and his name.
  await tabA.bringToFront();
  await tabA.keyboard.down('KeyD');
  await tabA.waitForTimeout(700);
  await tabA.keyboard.up('KeyD');
  const crops = [];
  for (const [direction, key] of DIRECTIONS) {
    await tabA.bringToFront();
    await tabA.keyboard.down(key);
    await tabA.waitForTimeout(200);
    await tabA.keyboard.up(key);
    const fromB = await waitFor(`B sees Ada idle facing ${direction}`, { read: () => spriteOf(tabB, ADA.name), until: (sprite) => sprite?.frame === sprite?.idleFrames[direction] }).catch(() => spriteOf(tabB, ADA.name));
    results.push(check(`B sees Ada turn ${direction}: her look's idle frame for that side`, fromB?.frame === fromB?.idleFrames[direction] && fromB?.frameSize === '16x24', fromB && `${fromB.textureKey} frame ${fromB.frame}, ${fromB.frameSize}`));
    await tabB.waitForTimeout(300);
    crops.push(await tabB.screenshot({ clip: await clipAround(tabB, ADA.name) }));
  }
  crops.forEach((crop, index) => writeFileSync(path.join(PROOF, `03-B-sees-Ada-${DIRECTIONS[index][0]}.png`), crop));

  await tabA.screenshot({ path: path.join(PROOF, '03-online-A.png') });
  await tabB.screenshot({ path: path.join(PROOF, '03-online-B.png') });
  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  roomServer.stop();
  devServer.stop();
}

report.results = results;
writeProof('03-online.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** A tab of its own browser context (its own player, remembering `character`), seated in the world. */
async function openTab(character) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(context, character);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${character.name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${character.name}: ${message.text()}`));
  await page.goto(`http://localhost:${CLIENT_PORT}/`);
  await page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0, null, { timeout: 20000 });
  return page;
}

function lookKey(look) {
  return `${look.skin}-${look.hair}-${look.clothes}-${look.gender}-${look.hairStyle}`;
}

/** Every character the tab draws: its name, its look in the replica and the texture it is drawn from. */
function drawnOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const looks = new Map(api.characters().map((character) => [character.eid, character.look]));
    return api.drawnNames().map((drawn) => ({ name: drawn.name, textureKey: drawn.textureKey, look: looks.get(drawn.eid) }));
  });
}

/** The sprite a tab draws the named character with: its texture, the frame on show, its size and each direction's idle frame. */
function spriteOf(page, name) {
  return page.evaluate((wanted) => {
    const api = window.__novaland;
    const textureKey = api.drawnNames().find((drawn) => drawn.name === wanted)?.textureKey;
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
    const frame = found[0]?.frame;
    return { textureKey, frame: frame ? Number(frame.name) : undefined, frameSize: frame ? `${frame.cutWidth}x${frame.cutHeight}` : undefined, idleFrames };
  }, name);
}

/** The screen rectangle round a named character and its name, in CSS pixels. */
function clipAround(page, name) {
  return page.evaluate((wanted) => {
    const api = window.__novaland;
    const camera = api.camera();
    const label = api.drawnNames().find((drawn) => drawn.name === wanted);
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    const left = canvas.left + (label.x - 14 - camera.worldView.x) * camera.zoom;
    const top = canvas.top + (label.y - 4 - camera.worldView.y) * camera.zoom;
    const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
    const width = 28 * camera.zoom;
    const height = 34 * camera.zoom;
    return { x: clamp(left, 0, canvas.width - width), y: clamp(top, 0, canvas.height - height), width, height };
  }, name);
}
