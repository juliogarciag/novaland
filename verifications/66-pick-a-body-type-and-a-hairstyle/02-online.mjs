/* global window, document */
/**
 * #66 online: against the real room server, a join carries the body type and
 * hairstyle picked in the creator, every other player sees and draws them, a
 * change of character reaches everyone, a rejoin keeps it, and a character
 * remembered before #66 joins with the first of each.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, ROOT, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 2966;
const CLIENT_PORT = 5967;
const VIEWPORT = { width: 960, height: 720 };
const BEA = { name: 'Bea', look: { skin: 2, hair: 4, clothes: 1, body: 1, hairStyle: 2 } };
const REMEMBERED_BEFORE_66 = { name: 'Old Timer', look: { skin: 5, hair: 0, clothes: 6 } };
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

  // ---- A makes a character in the creator: the last body type, the second hairstyle.
  const contextA = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const tabA = await newPage(contextA, 'A');
  await tabA.goto(`http://localhost:${CLIENT_PORT}/`);
  await tabA.waitForSelector('#creator[data-screen="creator"]');
  // Before the game exists the choices are read off the creator (01-solo checks they are the sim's lists).
  const shapes = await tabA.evaluate(() => Object.fromEntries(['body', 'hairStyle'].map((part) => [part, { length: document.querySelectorAll(`#creator input[name="${part}"]`).length }])));
  const madeByA = { body: shapes.body.length - 1, hairStyle: 1 };
  await tabA.check(`#creator input[name="body"][value="${madeByA.body}"]`);
  await tabA.check(`#creator input[name="hairStyle"][value="${madeByA.hairStyle}"]`);
  await tabA.fill('#creator input[name="name"]', 'Ada');
  await tabA.click('#creator button[type="submit"]');
  await waitUntilSeated(tabA);

  // ---- B returns as Bea: another body type with another hairstyle.
  const contextB = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(contextB, BEA);
  const tabB = await newPage(contextB, 'B');
  await tabB.goto(`http://localhost:${CLIENT_PORT}/`);
  await waitUntilSeated(tabB);

  const seen = await waitFor('each tab sees both characters', {
    read: async () => ({ fromA: await charactersOf(tabA), fromB: await charactersOf(tabB) }),
    until: ({ fromA, fromB }) => fromA.length === 2 && fromB.length === 2 && fromA.every((character) => character.drawn) && fromB.every((character) => character.drawn),
  }).catch(() => undefined);
  report.seen = seen;
  const adaIn = (characters) => characters?.find((character) => character.name === 'Ada');
  const beaIn = (characters) => characters?.find((character) => character.name === 'Bea');
  results.push(check("the server seats A with the body type and hairstyle A picked, and B's replica holds them", adaIn(seen?.fromB)?.look.body === madeByA.body && adaIn(seen?.fromB)?.look.hairStyle === madeByA.hairStyle, JSON.stringify(adaIn(seen?.fromB)?.look)));
  results.push(check("A's replica holds Bea's remembered body type and hairstyle", beaIn(seen?.fromA)?.look.body === BEA.look.body && beaIn(seen?.fromA)?.look.hairStyle === BEA.look.hairStyle, JSON.stringify(beaIn(seen?.fromA)?.look)));
  results.push(check('each tab draws the other player from a texture made for that look', drawnAsItsLook(adaIn(seen?.fromB)) && drawnAsItsLook(beaIn(seen?.fromA)), `${adaIn(seen?.fromB)?.drawn} | ${beaIn(seen?.fromA)?.drawn}`));
  await tabA.screenshot({ path: path.join(PROOF, 'online-A.png') });
  await tabB.screenshot({ path: path.join(PROOF, 'online-B.png') });

  // ---- A changes body type and hairstyle in the world: B sees it.
  await tabA.click('#change-character');
  await tabA.waitForSelector('#creator[data-screen="creator"]');
  await tabA.check('#creator input[name="body"][value="0"]');
  await tabA.check(`#creator input[name="hairStyle"][value="${shapes.hairStyle.length - 1}"]`);
  await tabA.click('#creator button[type="submit"]');
  const changedLook = { body: 0, hairStyle: shapes.hairStyle.length - 1 };
  const afterChange = await waitFor("B sees A's change", {
    read: () => charactersOf(tabB),
    until: (characters) => adaIn(characters)?.look.body === changedLook.body && adaIn(characters)?.look.hairStyle === changedLook.hairStyle && drawnAsItsLook(adaIn(characters)),
  }).catch(() => undefined);
  report.afterChange = afterChange;
  results.push(check("A's change of body type and hairstyle reaches B's replica and B draws it", afterChange !== undefined, JSON.stringify(adaIn(afterChange)?.look)));
  await tabB.screenshot({ path: path.join(PROOF, 'online-B-after-change.png') });

  // ---- A rejoins (a reload): the server seats A as the changed character.
  await tabA.reload();
  await waitUntilSeated(tabA);
  const afterRejoin = await waitFor('B sees A again after the rejoin', {
    read: () => charactersOf(tabB),
    until: (characters) => characters.length === 2 && adaIn(characters)?.look.body === changedLook.body && adaIn(characters)?.look.hairStyle === changedLook.hairStyle,
  }).catch(() => undefined);
  const creatorAfterRejoin = await tabA.evaluate(() => document.querySelector('#creator') !== null);
  report.afterRejoin = afterRejoin;
  results.push(check('a rejoin keeps the changed body type and hairstyle, without the creator', afterRejoin !== undefined && !creatorAfterRejoin, JSON.stringify(adaIn(afterRejoin)?.look)));

  // ---- A browser that remembered a character before #66 joins with the first of each.
  const contextC = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(contextC, REMEMBERED_BEFORE_66);
  const tabC = await newPage(contextC, 'C');
  await tabC.goto(`http://localhost:${CLIENT_PORT}/`);
  await waitUntilSeated(tabC);
  const withC = await waitFor("B sees C's character", { read: () => charactersOf(tabB), until: (characters) => characters.some((character) => character.name === REMEMBERED_BEFORE_66.name) }).catch(() => undefined);
  const oldTimer = withC?.find((character) => character.name === REMEMBERED_BEFORE_66.name);
  report.rememberedBefore66 = oldTimer;
  results.push(check('a character remembered before #66 joins without the creator, in its colours, with the first body type and hairstyle', oldTimer !== undefined && oldTimer.look.body === 0 && oldTimer.look.hairStyle === 0 && ['skin', 'hair', 'clothes'].every((part) => oldTimer.look[part] === REMEMBERED_BEFORE_66.look[part]), JSON.stringify(oldTimer?.look)));
  await tabC.screenshot({ path: path.join(PROOF, 'online-C-remembered-before-66.png') });

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  roomServer.stop();
  devServer.stop();
}

report.results = results;
writeProof('02-online.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

async function newPage(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${name}: ${message.text()}`));
  return page;
}

function waitUntilSeated(page) {
  return page.waitForFunction(() => window.__novaland?.online?.status().kind === 'online' && window.__novaland.sim.tick > 0 && document.querySelector('#creator') === null, null, { timeout: 15000 });
}

/** Every character in the tab's replica, with the texture the tab draws it from. */
function charactersOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const drawn = new Map(api.drawnNames().map((name) => [name.eid, name.textureKey]));
    return api.characters().map((character) => ({ ...character, drawn: drawn.get(character.eid) }));
  });
}

function drawnAsItsLook(character) {
  const { skin, hair, clothes, body, hairStyle } = character?.look ?? {};
  return character?.drawn?.endsWith(`/look/${skin}-${hair}-${clothes}-${body}-${hairStyle}`) ?? false;
}
