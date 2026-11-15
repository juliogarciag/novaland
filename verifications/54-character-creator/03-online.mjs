/* global window, document */
/**
 * V3: two browsers against one real world room. Each makes a different
 * character on the creator (which shows before anything is sent to the
 * server) and both see both characters, in the right colours, with the right
 * names above them, also after one walks. Then the edge: a client that speaks
 * the protocol directly sends malformed joins (bad palette index, 21
 * characters, a name that is not text, no character) and a few hundred
 * random ones; none takes a seat, none shows up in either browser, the server
 * keeps running, and a name that needs normalising arrives normalised. A
 * returning player (reload) is not asked again; after the server restarts both
 * pages come back by themselves as the same characters.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';
import { isPortOpen } from './processes.mjs';
import { STORAGE_KEY, creatorState, drawnAsItsCharacter, fillCreator, openPlayer, screenshot, submitCreator, waitInWorld, worldState } from './pages.mjs';

const SERVER_PORT = 5355;
const CLIENT_PORT = 5356;
const URL = `http://localhost:${CLIENT_PORT}/`;
const ADA = { name: 'Ada Lovelace', look: { skin: 4, hair: 6, clothes: 1 } };
const JOSE = { name: 'José 🚀', look: { skin: 0, hair: 3, clothes: 6 } };
const results = [];
const report = {};
const errors = [];
const serverDir = path.join(ROOT, 'packages/server');
const startServer = () => start('pnpm', ['dev'], { cwd: serverDir, env: { PORT: String(SERVER_PORT) } });

// The client's own Colyseus SDK, used here as a hostile client would: straight at the room, no creator in between.
const requireFromClient = createRequire(path.join(ROOT, 'packages/client/package.json'));
const { Client } = await import(pathToFileURL(requireFromClient.resolve('@colyseus/sdk')).href);
// The wire protocol the server speaks, read from the sim's own source so this script never pins a stale number.
const WIRE_PROTOCOL = Number(/export const WIRE_PROTOCOL = (\d+);/.exec(readFileSync(path.join(ROOT, 'packages/sim/src/core/wire.ts'), 'utf8'))?.[1]);
/** Joins the room directly, speaking its protocol, with whatever else `options` holds. */
const joinDirectly = (options) => new Client(`ws://localhost:${SERVER_PORT}`).joinById('world', { protocol: WIRE_PROTOCOL, ...options });

const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let server = startServer();
let browser;
try {
  // The boot line and the ready line prove both ports are this run's servers, not something that was already listening there.
  const portsUp = (await waitForPort(SERVER_PORT)) && (await waitForPort(CLIENT_PORT));
  const bootLine = portsUp && (await waitFor("the room server's boot line", { read: () => server.output.split('\n').find((line) => line.includes('world-room-listening')), until: Boolean }).catch(() => undefined));
  const clientReady = portsUp && (await waitFor("the dev server's ready line", { read: () => client.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('room server and dev server up, both started by this run', Boolean(bootLine) && clientReady, bootLine || `${lastLinesOf(server.output)} | ${lastLinesOf(client.output)}`));
  if (!bootLine || !clientReady) throw new Error('nothing to open');
  results.push(check('the wire protocol counts this change: 4 or later', WIRE_PROTOCOL >= 4, String(WIRE_PROTOCOL)));
  browser = await chromium.launch();
  const seatOf = (state, character) => state.seats.find((seat) => seat.name === character.name);
  const seesBoth = (state) => state.seats.length === 2 && drawnAsItsCharacter(seatOf(state, ADA), ADA) && drawnAsItsCharacter(seatOf(state, JOSE), JOSE);

  // 1. The creator comes before the join: nothing is sent to the server until the player enters the world.
  const a = await openPlayer(browser, URL, { name: 'A', errors });
  let joinRequests = 0;
  a.page.on('request', (request) => request.url().includes('/matchmake/') && (joinRequests += 1));
  await a.page.waitForSelector('#creator[data-screen="creator"]');
  await a.page.waitForTimeout(1000);
  const beforeJoin = await creatorState(a.page);
  results.push(check('online, a first visit shows the creator before joining: no game, no join request yet', beforeJoin.shown && !beforeJoin.hasGame && joinRequests === 0, `join requests: ${joinRequests}`));
  await fillCreator(a.page, ADA);
  await screenshot(a.page, '03-online-1-A-creator.png');
  await submitCreator(a.page);
  await waitInWorld(a.page);

  const b = await openPlayer(browser, URL, { name: 'B', errors });
  await b.page.waitForSelector('#creator[data-screen="creator"]');
  await fillCreator(b.page, JOSE);
  await screenshot(b.page, '03-online-2-B-creator.png');
  await submitCreator(b.page);
  await waitInWorld(b.page);

  // 2. Both see both.
  const aSees = await waitFor('A to see both characters', { read: () => worldState(a.page), until: seesBoth, timeoutMs: 15000 });
  const bSees = await waitFor('B to see both characters', { read: () => worldState(b.page), until: seesBoth, timeoutMs: 15000 });
  await screenshot(a.page, '03-online-3-A-sees-both.png');
  await screenshot(b.page, '03-online-4-B-sees-both.png');
  results.push(check('both pages are online replicas in different seats', aSees.isReplica && bSees.isReplica && aSees.status.kind === 'online' && bSees.status.kind === 'online' && aSees.localSlot !== bSees.localSlot, JSON.stringify({ a: aSees.localSlot, b: bSees.localSlot })));
  results.push(check("A sees both characters: each in its own colours with its own name above it", seesBoth(aSees), JSON.stringify(aSees.seats.map((seat) => ({ slot: seat.slot, name: seat.name, look: seat.look, label: seat.label })))));
  results.push(check("B sees both characters: each in its own colours with its own name above it", seesBoth(bSees), JSON.stringify(bSees.seats.map((seat) => ({ slot: seat.slot, name: seat.name, look: seat.look, label: seat.label })))));
  results.push(check('the two characters differ in name, in every colour and in the texture they are drawn from', seatOf(aSees, ADA).label.textureKey !== seatOf(aSees, JOSE).label.textureKey && ['skin', 'hair', 'clothes'].every((part) => seatOf(aSees, ADA).expectedColors[part] !== seatOf(aSees, JOSE).expectedColors[part])));
  results.push(check('each HUD names its own player and counts two online', aSees.hud.includes(`you: ${ADA.name}`) && bSees.hud.includes(`you: ${JOSE.name}`) && /2\/5 online/.test(aSees.hud), `${aSees.hud} | ${bSees.hud}`));
  report.bothSeeBoth = { aSees, bSees };

  // 3. The name follows its character.
  const adaBefore = seatOf(bSees, ADA).label;
  await a.page.keyboard.down('d');
  await a.page.waitForTimeout(700);
  await a.page.keyboard.up('d');
  const bAfterWalk = await waitFor('B to see Ada walk', { read: () => worldState(b.page), until: (state) => seesBoth(state) && seatOf(state, ADA).label.x > adaBefore.x + 16, timeoutMs: 15000 });
  await screenshot(b.page, '03-online-5-B-sees-A-walked.png');
  results.push(check("after A walks, B sees A's name still right above A's character, further right", seesBoth(bAfterWalk), `label x ${adaBefore.x} -> ${seatOf(bAfterWalk, ADA).label.x}`));

  // 4. The edge: malformed and random joins straight at the room.
  const hostile = [
    ['a palette index out of range', { character: { ...ADA, look: { ...ADA.look, skin: 99 } } }],
    ['a negative palette index', { character: { ...ADA, look: { ...ADA.look, hair: -1 } } }],
    ['a fractional palette index', { character: { ...ADA, look: { ...ADA.look, clothes: 1.5 } } }],
    ['a 21-character name', { character: { ...ADA, name: 'a'.repeat(21) } }],
    ['a 900-character name', { character: { ...ADA, name: 'a'.repeat(900) } }],
    ['options bigger than the room reads', { character: ADA, padding: 'x'.repeat(2000) }],
    ['a name that is a number', { character: { ...ADA, name: 21 } }],
    ['a name that is an object', { character: { ...ADA, name: { toString: 'Ada' } } }],
    ['an empty name', { character: { ...ADA, name: '   ' } }],
    ['a name with a line break', { character: { ...ADA, name: 'Ada\nLovelace' } }],
    ['a name with a text-direction override', { character: { ...ADA, name: '\u202eadA' } }],
    ['a character with a slot smuggled in', { character: { ...ADA, slot: 0 } }],
    ['no character', {}],
  ];
  let random = 54;
  const next = (bound) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random % bound;
  };
  const junk = [-1, 6, 8, 99, 0.5, null, 'x', {}, [], true, 2 ** 40];
  for (let round = 0; round < 300; round += 1) {
    const look = { skin: next(6), hair: next(8), clothes: next(8) };
    const name = ['Ada', 'a'.repeat(21), '', 7, null, 'A\tB', '😀'.repeat(21), ['Ada']][next(8)];
    // At least one thing is always wrong, so every one of these must be refused.
    if (name === 'Ada') look[['skin', 'hair', 'clothes'][next(3)]] = junk[next(junk.length)];
    hostile.push([`random #${round}`, { character: { name, look } }]);
  }
  // The SDK logs every refused join; those lines are the point of this step, not errors of the script.
  const { error: logError, warn: logWarning } = console;
  console.error = () => undefined;
  console.warn = () => undefined;
  const outcomes = [];
  for (const [what, options] of hostile) {
    const outcome = await joinDirectly(options).then(
      async (room) => {
        await room.leave();
        return { what, seated: true };
      },
      (error) => ({ what, seated: false, code: error?.code, message: error?.message }),
    );
    outcomes.push(outcome);
  }
  // A join too big for the HTTP front never reaches the room: the front closes it first.
  const oversized = await joinDirectly({ character: { ...ADA, name: 'a'.repeat(5000) } }).then(
    () => ({ seated: true }),
    (error) => ({ seated: false, code: error?.code, message: error?.message }),
  );
  results.push(check('a join with a 5000-character name is cut off by the HTTP front before it reaches the room (413)', !oversized.seated && oversized.code === 413, JSON.stringify(oversized)));
  const notRefused = outcomes.filter((outcome) => outcome.seated || outcome.code !== 526 || outcome.message !== 'invalid-character');
  results.push(check(`${hostile.length} malformed joins (bad palette index, 21 characters, non-text name, no character, random ones) are each refused as invalid-character`, notRefused.length === 0, JSON.stringify(notRefused.slice(0, 5))));
  await a.page.waitForTimeout(500);
  const aAfterHostile = await worldState(a.page);
  const bAfterHostile = await worldState(b.page);
  results.push(check('none of them took a seat or showed up: both browsers still see exactly the two legal characters, and the server still runs', seesBoth(aAfterHostile) && seesBoth(bAfterHostile) && /2\/5 online/.test(aAfterHostile.hud) && (await isPortOpen(SERVER_PORT)) && !/world-room-crashed/.test(server.output), aAfterHostile.hud));
  report.hostileJoins = { sent: hostile.length, refused: outcomes.filter((outcome) => !outcome.seated).length, sample: outcomes.slice(0, 13) };

  // 5. A legal join whose name needs normalising arrives normalised.
  const untidy = await joinDirectly({ character: { name: '  Grace    Hopper ', look: { skin: 2, hair: 1, clothes: 3 } } });
  untidy.onMessage('*', () => undefined);
  const withGrace = await waitFor('A to see the third player', { read: () => worldState(a.page), until: (state) => state.seats.length === 3 && state.seats.every((seat) => seat.label), timeoutMs: 15000 });
  await screenshot(a.page, '03-online-6-A-sees-normalised-third.png');
  const grace = withGrace.seats.find((seat) => seat.name !== ADA.name && seat.name !== JOSE.name);
  results.push(check('a name sent with stray spaces is shown as the server normalised it', grace?.name === 'Grace Hopper' && grace.label.name === 'Grace Hopper', JSON.stringify(grace?.name)));
  await untidy.leave();
  console.error = logError;
  console.warn = logWarning;
  // The drawn frame trails the replica by the interpolation buffer, so wait for the drawing to catch up before counting labels.
  const afterGrace = await waitFor('the third player to leave and its label to go', { read: () => worldState(a.page), until: (state) => state.seats.length === 2 && state.nameLabelsAlive === 2, timeoutMs: 15000 }).catch(() => worldState(a.page));
  results.push(check("when a player leaves, its name goes with it: exactly one name label per character left", afterGrace.nameLabelsAlive === 2 && seesBoth(afterGrace), `labels alive: ${afterGrace.nameLabelsAlive}`));

  // 5b. An entity id that changes hands shows the newcomer's name and look, never the leaver's.
  const first = await joinDirectly({ character: { name: 'First Guest', look: ADA.look } });
  first.onMessage('*', () => undefined);
  const withFirst = await waitFor('A to see the first guest', { read: () => worldState(a.page), until: (state) => state.seats.length === 3 && state.seats.every((seat) => seat.label), timeoutMs: 15000 });
  const firstSeat = withFirst.seats.find((seat) => seat.name === 'First Guest');
  await first.leave();
  await waitFor('the first guest to leave', { read: () => worldState(a.page), until: (state) => state.seats.length === 2, timeoutMs: 15000 });
  // The drawn frame trails the replica (see above): the wait is for the drawing to show the newcomer, and the check fails if it never does.
  const secondGuest = { name: 'Second Guest', look: { skin: 5, hair: 7, clothes: 4 } };
  const second = await joinDirectly({ character: secondGuest });
  second.onMessage('*', () => undefined);
  const withSecond = await waitFor('A to see the second guest', { read: () => worldState(a.page), until: (state) => state.seats.length === 3 && state.nameLabelsAlive === 3 && state.seats.find((seat) => seat.name === secondGuest.name)?.label?.name === secondGuest.name, timeoutMs: 15000 }).catch(() => worldState(a.page));
  const secondSeat = withSecond.seats.find((seat) => seat.name === secondGuest.name);
  results.push(check('a seat and entity id taken over by another player shows the new name and the new colours, with one label per character', secondSeat?.eid === firstSeat?.eid && drawnAsItsCharacter(secondSeat, secondGuest) && withSecond.nameLabelsAlive === 3, JSON.stringify({ firstEid: firstSeat?.eid, secondEid: secondSeat?.eid, label: secondSeat?.label, labelsAlive: withSecond.nameLabelsAlive })));
  await second.leave();
  await waitFor('the second guest to leave', { read: () => worldState(a.page), until: (state) => state.seats.length === 2, timeoutMs: 15000 });

  // 5c. A browser whose remembered character the server refuses is told so and led back to the creator.
  const c = await openPlayer(browser, 'about:blank', { name: 'C', errors: [] });
  await c.context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify({ name: 'Refused', look: { skin: 0, hair: 0, clothes: 0 } })]);
  // The page sends its remembered character; on the way the name is made illegal, as if the page and the server disagreed on the rule. The real room refuses it.
  await c.page.route('**/matchmake/**', (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}');
    return route.continue({ postData: JSON.stringify({ ...sent, character: { ...sent.character, name: 'a'.repeat(21) } }) });
  });
  await c.page.goto(URL);
  await c.page.waitForSelector('#screen[data-screen="character-refused"]', { timeout: 15000 });
  const refusedScreen = await c.page.evaluate(() => ({ text: document.querySelector('#screen p').textContent, buttons: [...document.querySelectorAll('#screen button')].filter((button) => !button.hidden).map((button) => button.textContent) }));
  await c.page.unroute('**/matchmake/**');
  await c.page.locator('#screen button', { hasText: 'Make a new character' }).click();
  await c.page.waitForSelector('#creator[data-screen="creator"]');
  const backAtCreator = await creatorState(c.page);
  results.push(check('a page whose character the server refuses shows the character-refused screen with one button, which opens the creator', /did not accept your character/.test(refusedScreen.text) && refusedScreen.buttons.join() === 'Make a new character' && backAtCreator.shown && !backAtCreator.hasGame, JSON.stringify(refusedScreen)));
  await c.context.close();

  // 6. A returning player is not asked again, online either.
  await b.page.reload();
  await waitInWorld(b.page);
  const bReturned = await waitFor('B back in the world', { read: () => worldState(b.page), until: seesBoth, timeoutMs: 15000 });
  const aSeesReturn = await waitFor('A to see B back', { read: () => worldState(a.page), until: seesBoth, timeoutMs: 15000 });
  results.push(check('after a reload B is not asked again: straight back in as the same character, and A sees it', !bReturned.creatorShown && seesBoth(bReturned) && seesBoth(aSeesReturn)));

  // 7. A rejoin after the server restarts carries the same character.
  server.stop();
  await a.page.waitForSelector('#screen[data-screen="disconnected"]', { timeout: 20000 });
  await waitFor('the server to stop', { read: () => isPortOpen(SERVER_PORT), until: (open) => !open, timeoutMs: 15000 });
  server = startServer();
  results.push(check('room server restarted', await waitForPort(SERVER_PORT)));
  const aBack = await waitFor('A back after the restart', { read: () => worldState(a.page), until: (state) => state.status?.kind === 'online' && seesBoth(state), timeoutMs: 40000 });
  const bBack = await waitFor('B back after the restart', { read: () => worldState(b.page), until: (state) => state.status?.kind === 'online' && seesBoth(state), timeoutMs: 40000 });
  await screenshot(a.page, '03-online-7-A-back-after-restart.png');
  results.push(check('after the server restarts both pages rejoin by themselves as the same two characters, without the creator', !aBack.creatorShown && !bBack.creatorShown && seesBoth(aBack) && seesBoth(bBack)));
  report.afterRestart = { aBack, bBack };

  // 8. A player changes character from inside the world: same player, same place, no page load, and everyone sees the new one.
  const GRACE = { name: 'Grace Hopper', look: { skin: 5, hair: 7, clothes: 4 } };
  const seesGraceAndJose = (state) => state.seats.length === 2 && drawnAsItsCharacter(seatOf(state, GRACE), GRACE) && drawnAsItsCharacter(seatOf(state, JOSE), JOSE);
  const aBefore = seatOf(await worldState(a.page), ADA);
  const aLoads = { count: 0 };
  a.page.on('load', () => (aLoads.count += 1));
  await a.page.locator('#change-character').click();
  await a.page.waitForSelector('#creator[data-screen="creator"]');
  await fillCreator(a.page, GRACE);
  await submitCreator(a.page);
  await a.page.waitForSelector('#creator', { state: 'detached' });
  const aChanged = await waitFor('A to be drawn as the new character', { read: () => worldState(a.page), until: seesGraceAndJose, timeoutMs: 15000 }).catch(() => worldState(a.page));
  const bSeesChange = await waitFor('B to see the new character', { read: () => worldState(b.page), until: seesGraceAndJose, timeoutMs: 15000 }).catch(() => worldState(b.page));
  await screenshot(b.page, '03-online-8-B-sees-A-changed.png');
  const aAfter = seatOf(aChanged, GRACE);
  results.push(check('changing character in the world changes it for both players, on the same entity, where it stood, without loading the page', seesGraceAndJose(aChanged) && seesGraceAndJose(bSeesChange) && aAfter?.eid === aBefore?.eid && aAfter?.slot === aBefore?.slot && aAfter?.position.x === aBefore?.position.x && aAfter?.position.y === aBefore?.position.y && aLoads.count === 0, JSON.stringify({ before: aBefore && { eid: aBefore.eid, position: aBefore.position }, after: aAfter && { eid: aAfter.eid, position: aAfter.position, name: aAfter.name }, bSees: bSeesChange.seats.map((seat) => seat.name), aLoads })));
  results.push(check('the browser remembers the new character and the HUD names it', aChanged.remembered === JSON.stringify(GRACE) && aChanged.hud.includes(`you: ${GRACE.name}`), JSON.stringify({ remembered: aChanged.remembered, hud: aChanged.hud })));
  report.changedInPlace = { aChanged, bSeesChange };

  results.push(check('no page errors', errors.filter((error) => !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource|Failed to fetch/.test(error)).length === 0, errors.join(' | ')));
  report.errors = errors;
} catch (error) {
  results.push(check('the script ran to the end', false, String(error?.stack ?? error)));
} finally {
  await browser?.close();
  client.stop();
  server.stop();
}

writeProof('03-online.json', report);
process.exit(summarize(results) ? 0 : 1);
