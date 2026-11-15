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
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, isPortOpen, start, summarize, waitForPort, writeProof } from './lib.mjs';
import { creatorState, drawnAsItsCharacter, fillCreator, openPlayer, screenshot, submitCreator, waitFor, waitInWorld, worldState } from './pages.mjs';

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

const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` } });
let server = startServer();
let browser;
try {
  results.push(check('client dev server and room server up', (await waitForPort(CLIENT_PORT)) && (await waitForPort(SERVER_PORT))));
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
  const aSees = await waitFor(() => worldState(a.page), seesBoth, 'A to see both characters');
  const bSees = await waitFor(() => worldState(b.page), seesBoth, 'B to see both characters');
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
  const bAfterWalk = await waitFor(() => worldState(b.page), (state) => seesBoth(state) && seatOf(state, ADA).label.x > adaBefore.x + 16, 'B to see Ada walk');
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
    ['no options at all', undefined],
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
    const outcome = await new Client(`ws://localhost:${SERVER_PORT}`).joinById('world', options).then(
      async (room) => {
        await room.leave();
        return { what, seated: true };
      },
      (error) => ({ what, seated: false, code: error?.code, message: error?.message }),
    );
    outcomes.push(outcome);
  }
  // A join too big for the HTTP front never reaches the room: the front closes it first.
  const oversized = await new Client(`ws://localhost:${SERVER_PORT}`).joinById('world', { character: { ...ADA, name: 'a'.repeat(5000) } }).then(
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
  const untidy = await new Client(`ws://localhost:${SERVER_PORT}`).joinById('world', { character: { name: '  Grace    Hopper ', look: { skin: 2, hair: 1, clothes: 3 } } });
  untidy.onMessage('*', () => undefined);
  const withGrace = await waitFor(() => worldState(a.page), (state) => state.seats.length === 3 && state.seats.every((seat) => seat.label), 'A to see the third player');
  await screenshot(a.page, '03-online-6-A-sees-normalised-third.png');
  const grace = withGrace.seats.find((seat) => seat.name !== ADA.name && seat.name !== JOSE.name);
  results.push(check('a name sent with stray spaces is shown as the server normalised it', grace?.name === 'Grace Hopper' && grace.label.name === 'Grace Hopper', JSON.stringify(grace?.name)));
  await untidy.leave();
  console.error = logError;
  console.warn = logWarning;
  await waitFor(() => worldState(a.page), (state) => state.seats.length === 2, 'the third player to leave');

  // 6. A returning player is not asked again, online either.
  await b.page.reload();
  await waitInWorld(b.page);
  const bReturned = await waitFor(() => worldState(b.page), seesBoth, 'B back in the world');
  const aSeesReturn = await waitFor(() => worldState(a.page), seesBoth, 'A to see B back');
  results.push(check('after a reload B is not asked again: straight back in as the same character, and A sees it', !bReturned.creatorShown && seesBoth(bReturned) && seesBoth(aSeesReturn)));

  // 7. A rejoin after the server restarts carries the same character.
  server.stop();
  await a.page.waitForSelector('#screen[data-screen="disconnected"]', { timeout: 20000 });
  await waitFor(() => isPortOpen(SERVER_PORT), (open) => !open, 'the server to stop');
  server = startServer();
  results.push(check('room server restarted', await waitForPort(SERVER_PORT)));
  const aBack = await waitFor(() => worldState(a.page), (state) => state.status?.kind === 'online' && seesBoth(state), 'A back after the restart', 40000);
  const bBack = await waitFor(() => worldState(b.page), (state) => state.status?.kind === 'online' && seesBoth(state), 'B back after the restart', 40000);
  await screenshot(a.page, '03-online-7-A-back-after-restart.png');
  results.push(check('after the server restarts both pages rejoin by themselves as the same two characters, without the creator', !aBack.creatorShown && !bBack.creatorShown && seesBoth(aBack) && seesBoth(bBack)));
  report.afterRestart = { aBack, bBack };

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
