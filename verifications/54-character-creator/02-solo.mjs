/* global window */
/**
 * V2: the creator and the remembered character, solo, against the real client
 * in Chromium. A first visit shows the creator and no game; the name is
 * required and at most 20 characters; picking swatches repaints the preview;
 * entering the world plays as that character, drawn in its colours with its
 * name above it; the browser remembers it, so a reload goes straight in; the
 * creator stays reachable (the address `#creator` and the Change character
 * button), starts from the remembered character and replaces it; a remembered
 * character that is no longer legal is asked for again; a second seat (dev J
 * key) shows a second, differently named character.
 */
import { chromium } from 'playwright';
import { check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';
import { STORAGE_KEY, creatorState, drawnAsItsCharacter, fillCreator, openPlayer, screenshot, submitCreator, waitInWorld, worldState } from './pages.mjs';

const CLIENT_PORT = 5354;
const URL = `http://localhost:${CLIENT_PORT}/`;
const ADA = { name: 'Ada Lovelace', look: { skin: 4, hair: 6, clothes: 1 } };
const JOSE = { name: 'José 🚀', look: { skin: 2, hair: 0, clothes: 6 } };
/* global document */
const results = [];
const report = {};
const errors = [];

const client = start('pnpm', ['dev'], { env: { PORT: String(CLIENT_PORT), VITE_SERVER_URL: undefined } });
let browser;
try {
  // The ready line proves the port is this run's server, not something that was already listening there.
  const ready = (await waitForPort(CLIENT_PORT)) && (await waitFor("the dev server's ready line", { read: () => client.output.includes(`localhost:${CLIENT_PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('client dev server up, started by this run (solo: no VITE_SERVER_URL)', ready, ready ? undefined : lastLinesOf(client.output)));
  if (!ready) throw new Error('nothing to open');
  browser = await chromium.launch();
  const { page } = await openPlayer(browser, URL, { name: 'solo', errors });

  // 1. First visit: the creator, and nothing else.
  await page.waitForSelector('#creator[data-screen="creator"]');
  await page.waitForFunction(() => document.querySelector('.creator-preview')?.dataset.look);
  const first = await creatorState(page);
  await screenshot(page, '02-solo-1-creator-first-visit.png');
  results.push(check('a first visit shows the creator before the world: no game yet, an empty name, a small palette per part', first.shown && !first.hasGame && first.name === '' && first.swatches.skin >= 2 && first.swatches.hair >= 2 && first.swatches.clothes >= 2 && first.swatches.skin <= 12, JSON.stringify(first)));
  report.firstVisit = first;

  // 2. The name is required and at most 20 characters; the rule is the sim's.
  await submitCreator(page);
  const empty = await creatorState(page);
  await page.locator('#creator input[name="name"]').fill('   ');
  await submitCreator(page);
  const blank = await creatorState(page);
  await page.locator('#creator input[name="name"]').fill('a'.repeat(21));
  await submitCreator(page);
  const tooLong = await creatorState(page);
  await screenshot(page, '02-solo-2-creator-name-too-long.png');
  await page.locator('#creator input[name="name"]').fill('Ada\tLovelace');
  await submitCreator(page);
  const control = await creatorState(page);
  results.push(check('an empty or blank name, 21 characters or a control character keep the player on the creator with the reason', [empty, blank].every((state) => state.shown && !state.hasGame && state.problem === 'empty') && tooLong.shown && tooLong.problem === 'too-long' && /20 characters/.test(tooLong.problemText) && control.shown && control.problem === 'forbidden-character', JSON.stringify({ empty: empty.problem, blank: blank.problem, tooLong: tooLong.problemText, control: control.problem })));
  await page.locator('#creator input[name="name"]').fill('a'.repeat(20));
  const typing = await creatorState(page);
  results.push(check('typing clears the reason', typing.problem === null && typing.problemText === ''));
  report.nameProblems = { empty, blank, tooLong, control };

  // 3. Pick a look and a name, enter the world as that character.
  await fillCreator(page, ADA);
  const filled = await creatorState(page);
  await screenshot(page, '02-solo-3-creator-filled.png');
  results.push(check('picking swatches repaints the preview in that look', filled.previewLook === '4-6-1' && JSON.stringify(filled.look) === JSON.stringify(ADA.look), JSON.stringify(filled)));
  await submitCreator(page);
  await waitInWorld(page);
  const entered = await worldState(page);
  await screenshot(page, '02-solo-4-in-the-world.png');
  results.push(check('entering the world closes the creator and plays as that character, in its colours, with its name above it', !entered.creatorShown && entered.seats.length === 1 && drawnAsItsCharacter(entered.seats[0], ADA), JSON.stringify(entered.seats[0])));
  results.push(check('the HUD names the local player', entered.hud.includes(`you: ${ADA.name}`), entered.hud));
  results.push(check('the browser remembers the character in localStorage', entered.remembered === JSON.stringify(ADA), String(entered.remembered)));
  report.entered = entered;

  // 4. A returning player is not asked again.
  await page.reload();
  await waitInWorld(page);
  const returned = await worldState(page);
  results.push(check('after a reload there is no creator: the player goes straight in as the remembered character', !returned.creatorShown && returned.seats.length === 1 && drawnAsItsCharacter(returned.seats[0], ADA), JSON.stringify(returned.seats[0])));

  // 5. The creator stays reachable from inside the world: it opens over the running game, and leaving it changes nothing.
  await page.keyboard.down('d');
  await waitFor('the player to have walked', { read: () => worldState(page), until: (state) => state.seats[0].position.x > returned.seats[0].position.x + 16, timeoutMs: 10000 });
  await page.keyboard.up('d');
  const walked = await waitFor('the player to stand still', { read: async () => [await worldState(page), await page.waitForTimeout(300), await worldState(page)], until: ([before, , after]) => before.seats[0].position.x === after.seats[0].position.x, timeoutMs: 10000 }).then(([, , after]) => after);
  const pageLoads = { count: 0 };
  page.on('load', () => (pageLoads.count += 1));
  const stillThere = (state) => state.seats.length === 1 && state.seats[0].eid === walked.seats[0].eid && state.seats[0].position.x === walked.seats[0].position.x && state.seats[0].position.y === walked.seats[0].position.y && drawnAsItsCharacter(state.seats[0], ADA);

  await page.locator('#change-character').click();
  await page.waitForSelector('#creator[data-screen="creator"]');
  await page.waitForFunction(() => document.querySelector('.creator-preview')?.dataset.look);
  const changing = await creatorState(page);
  await screenshot(page, '02-solo-5a-creator-over-the-game.png');
  results.push(check('the Change character button opens the creator over the running game, without loading the page, starting from the current character', changing.shown && changing.hasGame && pageLoads.count === 0 && changing.name === ADA.name && JSON.stringify(changing.look) === JSON.stringify(ADA.look) && (await page.evaluate(() => window.location.hash)) === '', JSON.stringify({ changing, pageLoads })));

  // The keys that walk type the name while the creator is open, and the player does not move.
  await page.locator('#creator input[name="name"]').fill('');
  await page.keyboard.type('wasd');
  const typed = await creatorState(page);
  await page.waitForTimeout(400);
  const whileTyping = await worldState(page);
  results.push(check('while the creator is open the walking keys type the name and the player stays put', typed.name === 'wasd' && whileTyping.seats[0].position.x === walked.seats[0].position.x && whileTyping.seats[0].position.y === walked.seats[0].position.y, JSON.stringify({ typed: typed.name, position: whileTyping.seats[0].position })));

  await page.keyboard.press('Escape');
  await page.waitForSelector('#creator', { state: 'detached' });
  const afterEscape = await worldState(page);
  results.push(check('Escape closes the creator and nothing changed: same player, same place, same character, same remembered one, no page load', stillThere(afterEscape) && afterEscape.remembered === JSON.stringify(ADA) && pageLoads.count === 0, JSON.stringify({ seat: afterEscape.seats[0], remembered: afterEscape.remembered, pageLoads })));

  await page.locator('#change-character').click();
  await page.waitForSelector('#creator[data-screen="creator"]');
  await fillCreator(page, JOSE);
  await page.locator('#creator .creator-close').click();
  await page.waitForSelector('#creator', { state: 'detached' });
  const afterClose = await worldState(page);
  results.push(check('the close button throws away what was picked: same player, same place, same character', stillThere(afterClose) && afterClose.remembered === JSON.stringify(ADA) && pageLoads.count === 0, JSON.stringify({ seat: afterClose.seats[0], remembered: afterClose.remembered, pageLoads })));

  await page.locator('#change-character').click();
  await page.waitForSelector('#creator[data-screen="creator"]');
  await submitCreator(page);
  await page.waitForSelector('#creator', { state: 'detached' });
  await page.waitForTimeout(500);
  const afterSameSave = await worldState(page);
  results.push(check('saving without changing anything keeps the player where they are: no page load, no new join', stillThere(afterSameSave) && pageLoads.count === 0, JSON.stringify({ seat: afterSameSave.seats[0], pageLoads })));

  // The game has its keys back.
  await page.keyboard.down('a');
  await waitFor('the player to walk again', { read: () => worldState(page), until: (state) => state.seats[0].position.x < walked.seats[0].position.x - 8, timeoutMs: 10000 });
  await page.keyboard.up('a');
  results.push(check('after the creator closes the walking keys walk again', true));

  // #creator in the address of a playing page opens the same creator in place.
  await page.evaluate(() => (window.location.hash = '#creator'));
  await page.waitForSelector('#creator[data-screen="creator"]');
  const fromAddress = await creatorState(page);
  results.push(check('#creator in the address of a playing page opens the creator over the game and the address is the plain one again', fromAddress.shown && fromAddress.hasGame && pageLoads.count === 0 && (await page.evaluate(() => window.location.hash)) === '', JSON.stringify({ fromAddress, pageLoads })));

  // A different character replaces the old one where the player stands: no page load, the same entity, the same place.
  const standing = await waitFor('the player to stand still again', { read: async () => [await worldState(page), await page.waitForTimeout(300), await worldState(page)], until: ([before, , after]) => before.seats[0].position.x === after.seats[0].position.x, timeoutMs: 10000 }).then(([, , after]) => after);
  await fillCreator(page, JOSE);
  await screenshot(page, '02-solo-5-creator-changing.png');
  await submitCreator(page);
  await page.waitForSelector('#creator', { state: 'detached' });
  const changed = await waitFor('the new character in the world', { read: () => worldState(page), until: (state) => state.seats.length === 1 && state.seats[0].label?.name === JOSE.name && state.seats[0].name === JOSE.name, timeoutMs: 15000 }).catch(() => worldState(page));
  await screenshot(page, '02-solo-6-changed-character.png');
  results.push(check('a different character replaces the old one in the world and in the browser, and the address is the plain one', changed.seats.length === 1 && drawnAsItsCharacter(changed.seats[0], JOSE) && changed.remembered === JSON.stringify(JOSE) && changed.hash === '', JSON.stringify({ seat: changed.seats[0], remembered: changed.remembered, hash: changed.hash })));
  results.push(check('the change happens where the player stands: the same entity, the same place, no page load', changed.seats[0].eid === standing.seats[0].eid && changed.seats[0].position.x === standing.seats[0].position.x && changed.seats[0].position.y === standing.seats[0].position.y && pageLoads.count === 0 && changed.hud.includes(`you: ${JOSE.name}`), JSON.stringify({ before: standing.seats[0].position, after: changed.seats[0].position, pageLoads })));
  await page.reload();
  await waitInWorld(page);
  const afterChangeReload = await worldState(page);
  results.push(check('after a reload the player comes back as the changed character', afterChangeReload.seats.length === 1 && drawnAsItsCharacter(afterChangeReload.seats[0], JOSE), JSON.stringify(afterChangeReload.seats[0])));
  report.changed = changed;

  // 6. A second seat is a second character with its own name.
  await page.keyboard.press('j');
  const two = await waitFor('a second character drawn', { read: () => worldState(page), until: (state) => state.seats.length === 2 && state.seats.every((seat) => seat.label), timeoutMs: 15000 });
  await screenshot(page, '02-solo-7-two-characters.png');
  const guest = two.seats[1];
  results.push(check('a second seat shows a second character with a different name and look, both names drawn', drawnAsItsCharacter(two.seats[0], JOSE) && guest.name === 'Guest 2' && guest.label.name === 'Guest 2' && guest.label.textureKey !== two.seats[0].label.textureKey, JSON.stringify(two.seats.map((seat) => ({ name: seat.name, label: seat.label })))));
  report.twoSeats = two;

  // 7. A remembered character that is no longer legal is asked for again.
  const stale = [
    ['a palette index out of range', JSON.stringify({ ...JOSE, look: { ...JOSE.look, hair: 99 } })],
    ['a 21-character name', JSON.stringify({ ...JOSE, name: 'a'.repeat(21) })],
    ['a name that is not text', JSON.stringify({ ...JOSE, name: 21 })],
    ['something that is not JSON', 'not json'],
  ];
  const staleShown = [];
  for (const [what, stored] of stale) {
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, stored]);
    await page.reload();
    await page.waitForSelector('#creator[data-screen="creator"]');
    const state = await creatorState(page);
    staleShown.push({ what, shown: state.shown, hasGame: state.hasGame, name: state.name });
  }
  results.push(check('a remembered character that is not legal any more (bad palette index, 21 characters, non-text name, junk) opens the creator instead of entering the world', staleShown.every((state) => state.shown && !state.hasGame && state.name === ''), JSON.stringify(staleShown)));

  results.push(check('no page errors and no console errors', errors.length === 0, errors.join(' | ')));
  report.errors = errors;
} catch (error) {
  results.push(check('the script ran to the end', false, String(error?.stack ?? error)));
} finally {
  await browser?.close();
  client.stop();
}

writeProof('02-solo.json', report);
process.exit(summarize(results) ? 0 : 1);
