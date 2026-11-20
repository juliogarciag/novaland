/* global window, document */
/**
 * #66 solo: a player picks a gender and a hairstyle in the creator, as two
 * separate choices, sees them in the preview, enters the world as them,
 * changes them from inside the world, keeps them across a reload, and a
 * character remembered before these choices existed still goes straight in.
 * Every expected value comes from `window.__novaland` (characterShapes,
 * characters(), drawnNames()).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { PROOF, check, lastLinesOf, rememberCharacter, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const PORT = 5966;
const VIEWPORT = { width: 960, height: 720 };
/** A character as a browser remembered it before #66: three palette indexes, no gender, no hairstyle. */
const REMEMBERED_BEFORE_66 = { name: 'Old Timer', look: { skin: 1, hair: 2, clothes: 3 } };
const results = [];
const report = {};
const pageErrors = [];

const devServer = start('pnpm', ['dev'], { env: { PORT: String(PORT) } });
let browser;
try {
  const ready = (await waitForPort(PORT)) && (await waitFor("the dev server's ready line", { read: () => devServer.output.includes(`localhost:${PORT}/`), until: Boolean }).catch(() => false));
  results.push(check('dev server up, started by this run', ready, ready ? undefined : lastLinesOf(devServer.output)));
  if (!ready) throw new Error('nothing to open');
  browser = await chromium.launch();

  // ---- A first visit: the creator offers both choices.
  const page = await newPage(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 }), 'first visit');
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#creator[data-screen="creator"]');
  // The game, and with it window.__novaland, does not exist before the creator is done: the choices are read off the creator here and compared with the sim's lists once in the world.
  const offered = await page.evaluate(() =>
    Object.fromEntries(
      ['gender', 'hairStyle'].map((part) => [
        part,
        {
          legend: document.querySelector(`#creator fieldset[data-part="${part}"] legend`)?.textContent,
          options: [...document.querySelectorAll(`#creator input[name="${part}"]`)].map((radio) => ({ value: Number(radio.value), label: radio.getAttribute('aria-label') })),
        },
      ]),
    ),
  );
  report.offered = offered;
  const shapes = Object.fromEntries(['gender', 'hairStyle'].map((part) => [part, offered[part].options.map((option) => ({ name: option.label?.replace(/^[^:]*: /, '') }))]));
  results.push(check('the creator offers at least two genders, by name', offered.gender.legend === 'Gender' && shapes.gender.length >= 2, JSON.stringify(offered.gender)));
  results.push(check('the creator offers at least three hairstyles, by name, as a choice of its own', offered.hairStyle.legend === 'Hairstyle' && shapes.hairStyle.length >= 3, JSON.stringify(offered.hairStyle)));
  await page.screenshot({ path: path.join(PROOF, 'creator.png') });

  // ---- The keys that walk turn the figure in the preview, outside the name field.
  const previewState = () => page.evaluate(() => ({ facing: document.querySelector('#creator .creator-preview')?.dataset.facing, pixels: document.querySelector('#creator .creator-preview')?.toDataURL(), gender: document.querySelector('#creator input[name="gender"]:checked')?.value, name: document.querySelector('#creator input[name="name"]').value }));
  const facingNow = (way) => waitFor(`the preview facing ${way}`, { read: previewState, until: (state) => state.facing === way }).catch(() => undefined);
  await page.click('#creator fieldset[data-part="gender"] label');
  const standing = await facingNow('down');
  const turned = {};
  for (const [key, way] of [['KeyD', 'right'], ['KeyW', 'up'], ['KeyA', 'left'], ['KeyS', 'down'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowLeft', 'left'], ['ArrowDown', 'down']]) {
    await page.keyboard.press(key);
    turned[key] = await facingNow(way);
    if (way !== 'down') await page.locator('#creator .creator-preview').screenshot({ path: path.join(PROOF, `preview-facing-${way}.png`) });
  }
  const genderKept = Object.values(turned).every((state) => state?.gender === standing?.gender);
  report.turning = { standing: standing?.facing, turned: Object.fromEntries(Object.entries(turned).map(([key, state]) => [key, state?.facing])) };
  results.push(check('W, A, S, D and the arrows turn the figure in the preview, with focus on a picker', standing !== undefined && Object.values(turned).every(Boolean), JSON.stringify(report.turning)));
  results.push(check('each way draws a different figure', new Set(['KeyS', 'KeyW', 'KeyA', 'KeyD'].map((key) => turned[key]?.pixels)).size === 4));
  results.push(check('an arrow on a picker turns the figure instead of picking another choice', genderKept, `gender stays ${standing?.gender}`));
  await page.focus('#creator input[name="name"]');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyW');
  const typing = await previewState();
  results.push(check('typing W, A, S or D in the name field types it and leaves the figure as it faces', typing.name.endsWith('dw') && typing.facing === 'down', JSON.stringify({ name: typing.name, facing: typing.facing })));
  await page.fill('#creator input[name="name"]', '');

  // ---- Picking a gender picks its suggested hairstyle. Start each time from another gender wearing the last hairstyle, so the pick is a real change.
  const hairStyleChecked = () => page.evaluate(() => Number(document.querySelector('#creator input[name="hairStyle"]:checked')?.value));
  const suggestedHairStyles = [];
  for (let gender = 0; gender < shapes.gender.length; gender += 1) {
    await page.check(`#creator input[name="gender"][value="${(gender + 1) % shapes.gender.length}"]`);
    await page.check(`#creator input[name="hairStyle"][value="${shapes.hairStyle.length - 1}"]`);
    await page.check(`#creator input[name="gender"][value="${gender}"]`);
    suggestedHairStyles.push(await hairStyleChecked());
  }
  report.suggestedHairStyles = suggestedHairStyles;
  await page.check('#creator input[name="gender"][value="1"]');
  await page.screenshot({ path: path.join(PROOF, 'creator-female-picked.png') });

  // ---- Every pairing previews differently: any hairstyle goes with any gender. The gender is picked first, then the hairstyle over its suggestion.
  const previews = {};
  for (let gender = 0; gender < shapes.gender.length; gender += 1) {
    for (let hairStyle = 0; hairStyle < shapes.hairStyle.length; hairStyle += 1) {
      await page.check(`#creator input[name="gender"][value="${gender}"]`);
      await page.check(`#creator input[name="hairStyle"][value="${hairStyle}"]`);
      const shown = await waitFor(`the preview of gender ${gender}, hairstyle ${hairStyle}`, {
        read: () => page.evaluate(() => ({ look: document.querySelector('#creator .creator-preview')?.dataset.look, pixels: document.querySelector('#creator .creator-preview')?.toDataURL() })),
        until: (preview) => preview.look?.endsWith(`-${gender}-${hairStyle}`),
      }).catch(() => undefined);
      previews[`${gender}-${hairStyle}`] = shown;
      await page.locator('#creator .creator-preview').screenshot({ path: path.join(PROOF, `preview-${shapes.gender[gender].name}-${shapes.hairStyle[hairStyle].name.replace(/ /g, '-')}.png`) });
    }
  }
  const pairings = Object.values(previews);
  const allShown = pairings.every(Boolean);
  results.push(check(`the preview follows both pickers through all ${pairings.length} pairings`, allShown, Object.keys(previews).join(', ')));
  results.push(check('every pairing of gender and hairstyle draws a different preview', allShown && new Set(pairings.map((preview) => preview.pixels)).size === pairings.length, `${new Set(pairings.filter(Boolean).map((preview) => preview.pixels)).size} distinct`));

  // ---- Enter the world as the last gender with the last hairstyle.
  const lastGender = shapes.gender.length - 1;
  const lastHairStyle = shapes.hairStyle.length - 1;
  await page.check(`#creator input[name="gender"][value="${lastGender}"]`);
  await page.check(`#creator input[name="hairStyle"][value="${lastHairStyle}"]`);
  await page.fill('#creator input[name="name"]', 'Bea');
  await page.click('#creator button[type="submit"]');
  await page.waitForFunction(() => window.__novaland?.sim.tick > 10 && window.__novaland.drawnNames().length > 0, null, { timeout: 15000 });
  const entered = await localCharacterOf(page);
  report.entered = entered;
  const simShapes = await page.evaluate(() => window.__novaland.characterShapes);
  report.simShapes = simShapes;
  results.push(check("picking a gender in the creator picked the hairstyle the sim suggests for it", simShapes.gender.every((gender, index) => suggestedHairStyles[index] === gender.defaultHairStyle), `${JSON.stringify(suggestedHairStyles)} vs ${JSON.stringify(simShapes.gender.map((gender) => gender.defaultHairStyle))}`));
  results.push(check('and the player still entered with another hairstyle picked after it', simShapes.gender[lastGender].defaultHairStyle !== lastHairStyle && entered.character?.look.hairStyle === lastHairStyle));
  results.push(check("the creator's choices are the sim's lists, in order", ['gender', 'hairStyle'].every((part) => simShapes[part].length === shapes[part].length && simShapes[part].every((shape, index) => shape.name === shapes[part][index].name)), JSON.stringify(simShapes)));
  results.push(check('the player enters the world with the gender and hairstyle picked', entered.character?.look.gender === lastGender && entered.character?.look.hairStyle === lastHairStyle && entered.character?.name === 'Bea', JSON.stringify(entered.character)));
  const layersLoaded = await page.evaluate(() => [...window.__novaland.characterShapes.gender, ...window.__novaland.characterShapes.hairStyle].map((shape) => ({ sheet: shape.sheet, loaded: window.__novaland.game.textures.exists(shape.sheet) })));
  report.layersLoaded = layersLoaded;
  results.push(check('the game loaded every body sheet (one per gender) and hair layer sheet, so looks are laid from layers, not the plain sheet', layersLoaded.every((layer) => layer.loaded), JSON.stringify(layersLoaded)));
  results.push(check('the renderer draws the player from a texture made for that look', entered.drawn?.textureKey?.endsWith(`/look/${lookKeyOf(entered.character.look)}`), entered.drawn?.textureKey));
  results.push(check('the browser remembers both choices', entered.remembered?.look?.gender === lastGender && entered.remembered?.look?.hairStyle === lastHairStyle, JSON.stringify(entered.remembered)));
  await page.screenshot({ path: path.join(PROOF, 'entered.png') });

  // ---- Change them from inside the world: the same player, where it stands.
  await page.click('#change-character');
  await page.waitForSelector('#creator[data-screen="creator"]');
  const genderShownOnOpen = await page.isChecked(`#creator input[name="gender"][value="${lastGender}"]`);
  const hairShownOnOpen = await page.isChecked(`#creator input[name="hairStyle"][value="${lastHairStyle}"]`);
  results.push(check('the creator opened from the world starts from the gender and hairstyle worn', genderShownOnOpen && hairShownOnOpen));
  await page.click('#creator .creator-preview');
  await page.keyboard.press('ArrowLeft');
  const turnedOverGame = await facingNow('left');
  const stillPlaying = await localCharacterOf(page);
  results.push(check('the creator opened from the world turns too, and the player in the world does not walk', turnedOverGame !== undefined && stillPlaying.moveIntent?.x === 0 && stillPlaying.moveIntent?.y === 0, JSON.stringify(stillPlaying.moveIntent)));
  await page.check('#creator input[name="gender"][value="0"]');
  await page.check('#creator input[name="hairStyle"][value="1"]');
  await page.screenshot({ path: path.join(PROOF, 'change-character.png') });
  await page.click('#creator button[type="submit"]');
  const changed = await waitFor('the sim sees the change', { read: () => localCharacterOf(page), until: (state) => state.character?.look.gender === 0 && state.character?.look.hairStyle === 1 }).catch(() => undefined);
  report.changed = changed;
  results.push(check('changing character gives the same player the other gender and hairstyle', changed !== undefined && changed.eid === entered.eid, changed && JSON.stringify(changed.character)));
  results.push(check('and keeps the rest of the look and the name', changed !== undefined && changed.character.name === 'Bea' && ['skin', 'hair', 'clothes'].every((part) => changed.character.look[part] === entered.character.look[part])));
  const redrawn = await waitFor('the renderer draws the new look', { read: () => localCharacterOf(page), until: (state) => state.drawn?.textureKey?.endsWith(`/look/${lookKeyOf(state.character.look)}`) }).catch(() => undefined);
  results.push(check('the renderer draws the player in the new look', redrawn !== undefined, redrawn?.drawn?.textureKey));
  await page.screenshot({ path: path.join(PROOF, 'changed.png') });

  // ---- A reload is a returning player: straight in, as the changed character.
  await page.reload();
  await page.waitForFunction(() => window.__novaland?.sim.tick > 10, null, { timeout: 15000 });
  const reloaded = await localCharacterOf(page);
  report.reloaded = reloaded;
  results.push(check('after a reload the player goes straight in with the changed gender and hairstyle', !reloaded.creatorShown && reloaded.character?.look.gender === 0 && reloaded.character?.look.hairStyle === 1, JSON.stringify(reloaded.character)));

  // ---- A character remembered before #66 still goes straight in.
  const oldContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await rememberCharacter(oldContext, REMEMBERED_BEFORE_66);
  const oldPage = await newPage(oldContext, 'remembered before #66');
  await oldPage.goto(`http://localhost:${PORT}/`);
  await oldPage.waitForFunction(() => window.__novaland?.sim.tick > 10 && window.__novaland.drawnNames().length > 0, null, { timeout: 15000 });
  const old = await localCharacterOf(oldPage);
  report.rememberedBefore66 = old;
  results.push(check('a character remembered before genders existed skips the creator', !old.creatorShown, `creator shown: ${old.creatorShown}`));
  results.push(check('and plays with its colours and name, in the first gender and hairstyle', old.character?.name === REMEMBERED_BEFORE_66.name && old.character?.look.gender === 0 && old.character?.look.hairStyle === 0 && ['skin', 'hair', 'clothes'].every((part) => old.character?.look[part] === REMEMBERED_BEFORE_66.look[part]), JSON.stringify(old.character)));
  await oldPage.screenshot({ path: path.join(PROOF, 'remembered-before-66.png') });

  results.push(check('no page errors', pageErrors.length === 0, pageErrors.join(' | ')));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  await browser?.close();
  devServer.stop();
}

report.results = results;
writeProof('01-solo.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

async function newPage(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && pageErrors.push(`${name}: ${message.text()}`));
  return page;
}

/** The local player's entity, its character in the sim, how the renderer draws it, what the browser remembers and whether the creator is up. */
function localCharacterOf(page) {
  return page.evaluate(() => {
    const api = window.__novaland;
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    const character = player ? api.characters().find((candidate) => candidate.eid === player.id) : undefined;
    const drawn = player ? api.drawnNames().find((name) => name.eid === player.id) : undefined;
    let remembered;
    try {
      remembered = JSON.parse(window.localStorage.getItem('novaland.character'));
    } catch {
      remembered = undefined;
    }
    return { eid: player?.id, character, drawn, remembered, moveIntent: player?.components.MoveIntent, creatorShown: document.querySelector('#creator') !== null };
  });
}

/** How the client names a look in texture keys (`lookKey` in packages/client/src/render/characterSheet.ts). */
function lookKeyOf(look) {
  return `${look.skin}-${look.hair}-${look.clothes}-${look.gender}-${look.hairStyle}`;
}
