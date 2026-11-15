/* global window, document */
/** What the browser checks of this ticket share: driving the creator screen and reading what the game shows. */
import path from 'node:path';
import { PROOF } from './lib.mjs';

export const STORAGE_KEY = 'novaland.character';

/** Opens `url` in a fresh browser context (its own localStorage: a new player) and collects its errors. */
export async function openPlayer(browser, url, { name, errors, viewport = { width: 960, height: 720 } }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
  page.on('console', (message) => message.type() === 'error' && errors.push(`${name}: ${message.text()}`));
  await page.goto(url);
  return { name, context, page };
}

/** What the creator screen shows right now, or `{ shown: false }`. */
export function creatorState(page) {
  return page.evaluate(() => {
    const form = document.querySelector('#creator[data-screen="creator"]');
    if (!form) return { shown: false, hasGame: Boolean(window.__novaland) };
    const picked = (part) => Number(form.querySelector(`input[name="${part}"]:checked`)?.value);
    const problem = form.querySelector('.creator-problem');
    return {
      shown: true,
      hasGame: Boolean(window.__novaland),
      name: form.querySelector('input[name="name"]').value,
      look: { skin: picked('skin'), hair: picked('hair'), clothes: picked('clothes') },
      swatches: { skin: form.querySelectorAll('input[name="skin"]').length, hair: form.querySelectorAll('input[name="hair"]').length, clothes: form.querySelectorAll('input[name="clothes"]').length },
      problem: problem.dataset.problem ?? null,
      problemText: problem.textContent,
      previewLook: form.querySelector('.creator-preview').dataset.look ?? null,
    };
  });
}

/** Fills the creator like a player does: clicks one swatch per part, types the name. Does not submit. */
export async function fillCreator(page, { name, look }) {
  for (const part of ['skin', 'hair', 'clothes']) {
    // The radio is an invisible layer over its colour chip, so the click lands on the label the player sees.
    await page.locator(`#creator input[name="${part}"][value="${look[part]}"]`).check({ force: true });
  }
  await page.locator('#creator input[name="name"]').fill(name);
}

export async function submitCreator(page) {
  await page.locator('#creator button[type="submit"]').click();
}

/** Waits until the game runs and the local player's character is in the sim and drawn. */
export async function waitInWorld(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const api = window.__novaland;
      if (!api || !api.game.scene.isActive('world')) return false;
      const local = api.snapshot().entities.find((entity) => entity.components.Player?.slot === api.localSlot());
      return Boolean(local) && api.drawnNames().some((drawn) => drawn.eid === local.id);
    },
    undefined,
    { timeout },
  );
}

/**
 * Everything a check needs of a running game: the characters in the sim (by
 * seat), the names drawn (with where, and the colours of the texture each
 * character is drawn from), what the palettes say those colours should be,
 * the HUD and what the browser remembers.
 */
export function worldState(page, storageKey = STORAGE_KEY) {
  return page.evaluate((key) => {
    const api = window.__novaland;
    const hex = (color) => color.toString(16).padStart(6, '0');
    const players = api.snapshot().entities.filter((entity) => entity.components.Player);
    const characters = api.characters();
    const drawn = api.drawnNames();
    const world = api.game.scene.getScene('world');
    const colorsOfTexture = (textureKey) => {
      if (!textureKey || !api.game.textures.exists(textureKey)) return [];
      const source = api.game.textures.get(textureKey).getSourceImage();
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext('2d');
      context.drawImage(source, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let offset = 0; offset < data.length; offset += 4) {
        if (data[offset + 3] === 255) colors.add(hex((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]));
      }
      return [...colors].sort();
    };
    const seats = players
      .map((entity) => {
        const character = characters.find((candidate) => candidate.eid === entity.id);
        const label = drawn.find((candidate) => candidate.eid === entity.id);
        const position = entity.components.Position;
        return {
          slot: entity.components.Player.slot,
          eid: entity.id,
          name: character?.name,
          look: character?.look,
          expectedColors: character && {
            skin: hex(api.characterPalettes.skin[character.look.skin].color),
            hair: hex(api.characterPalettes.hair[character.look.hair].color),
            clothes: hex(api.characterPalettes.clothes[character.look.clothes].color),
          },
          // Every palette colour of the three parts that this character did not pick: none may be left in its texture.
          colorsOfOtherLooks: character && ['skin', 'hair', 'clothes'].flatMap((part) => api.characterPalettes[part].filter((_, index) => index !== character.look[part]).map((swatch) => hex(swatch.color))),
          position: { x: position.x * api.pixelsPerMetre, y: position.y * api.pixelsPerMetre },
          label: label ? { name: label.name, x: label.x, y: label.y, textureKey: label.textureKey } : null,
          textureColors: colorsOfTexture(label?.textureKey),
        };
      })
      .sort((a, b) => a.slot - b.slot);
    return {
      // Every name label alive in the world scene, drawn for a seat or not: a label left behind by a player who went away shows up here.
      nameLabelsAlive: world.children.list.filter((child) => child.type === 'Text').length,
      localSlot: api.localSlot(),
      isReplica: api.sim.isReplica === true,
      status: api.online?.status() ?? null,
      seats,
      hud: world.scene.get('hud').children.list.map((child) => child.text).join('\n'),
      remembered: window.localStorage.getItem(key),
      hash: window.location.hash,
      creatorShown: Boolean(document.querySelector('#creator')),
      changeButton: Boolean(document.querySelector('#change-character')),
    };
  }, storageKey);
}

/** True when a seat is drawn as its character: the right name right above it, in a texture painted in its three colours. */
export function drawnAsItsCharacter(seat, character) {
  if (!seat || !seat.label || seat.name !== character.name) return false;
  const sameLook = seat.look.skin === character.look.skin && seat.look.hair === character.look.hair && seat.look.clothes === character.look.clothes;
  const colors = seat.expectedColors;
  // Its own three colours are in the texture and nobody else's are: an unpainted sheet (the template's colours are palette colours too) does not pass.
  const painted = [colors.skin, colors.hair, colors.clothes].every((color) => seat.textureColors.includes(color)) && !seat.colorsOfOtherLooks.some((color) => seat.textureColors.includes(color));
  // The label is centred on the character and ends just above its head: the sprite is 24 px tall with its origin at 3/4.
  const above = Math.abs(seat.label.x - seat.position.x) <= 1 && seat.label.y < seat.position.y - 17 && seat.label.y > seat.position.y - 24;
  return sameLook && painted && above && seat.label.name === character.name && seat.label.textureKey === `player/look/${character.look.skin}-${character.look.hair}-${character.look.clothes}`;
}

export function screenshot(page, file) {
  return page.screenshot({ path: path.join(PROOF, file) });
}
