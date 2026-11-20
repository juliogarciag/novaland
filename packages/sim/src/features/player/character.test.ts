import { addComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../core/commands';
import { __testing__, createReplica } from '../../core/create';
import { applyWorldState } from '../../core/replica';
import { createRng } from '../../core/rng';
import type { Sim, SimHandle } from '../../core/sim';
import { hashSnapshot } from '../../core/snapshot';
import { Position } from '../../core/transform';
import { getRenderables } from '../../core/view';
import { diffWorldState, worldState, type WorldState } from '../../core/worldState';
import { codePointsOf, guestCharacter, readCharacter, readCharacterName, readRememberedCharacter, sameCharacter, type Character } from './character';
import { characterPalettes, characterShapes, isPlayerDefId, MAX_NAME_CHARACTERS, MAX_NAME_CODE_POINTS } from './defs';
import { findPlayerEntity, getCharacter } from './queries';

describe('readCharacterName', () => {
  it('accepts a plain name and gives it back unchanged', () => {
    expect(readCharacterName('Ada')).toEqual({ name: 'Ada' });
  });

  it('normalises instead of trusting: outer spaces go, runs of spaces become one, letters are composed', () => {
    expect(readCharacterName('  Ada   Lovelace  ')).toEqual({ name: 'Ada Lovelace' });
    expect(readCharacterName('Ada\u00a0\u3000Lovelace')).toEqual({ name: 'Ada Lovelace' });
    // An "é" typed as e + combining acute is stored as the single composed letter.
    expect(readCharacterName('Jose\u0301')).toEqual({ name: 'José' });
  });

  it('counts user-visible characters, not UTF-16 units: 20 emoji fit, 21 letters do not', () => {
    const twentyEmoji = '😀'.repeat(MAX_NAME_CHARACTERS);
    expect(twentyEmoji.length).toBe(2 * MAX_NAME_CHARACTERS);
    expect(readCharacterName(twentyEmoji)).toEqual({ name: twentyEmoji });
    expect(readCharacterName('a'.repeat(MAX_NAME_CHARACTERS))).toEqual({ name: 'a'.repeat(MAX_NAME_CHARACTERS) });
    expect(readCharacterName('a'.repeat(MAX_NAME_CHARACTERS + 1))).toEqual({ problem: 'too-long' });
    expect(readCharacterName('😀'.repeat(MAX_NAME_CHARACTERS + 1))).toEqual({ problem: 'too-long' });
    // An accented letter and a family emoji are each one visible character.
    expect(readCharacterName('e\u0301'.repeat(MAX_NAME_CHARACTERS))).toEqual({ name: '\u00e9'.repeat(MAX_NAME_CHARACTERS) });
    expect(readCharacterName('👨‍👩‍👧 Ada')).toEqual({ name: '👨‍👩‍👧 Ada' });
  });

  it('refuses a name that would not fit the stored code points, however few characters it shows', () => {
    // Twenty flags are twenty visible characters and forty code points: they fit. Twenty families do not.
    expect(readCharacterName('\ud83c\uddf5\ud83c\uddea'.repeat(MAX_NAME_CHARACTERS))).toEqual({ name: '\ud83c\uddf5\ud83c\uddea'.repeat(MAX_NAME_CHARACTERS) });
    expect(codePointsOf('\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67'.repeat(MAX_NAME_CHARACTERS)).length).toBeGreaterThan(MAX_NAME_CODE_POINTS);
    expect(readCharacterName('\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67'.repeat(MAX_NAME_CHARACTERS))).toEqual({ problem: 'too-long' });
    expect(readCharacterName('x'.repeat(100_000))).toEqual({ problem: 'too-long' });
  });

  it('refuses what is not text, what is empty and what holds control or formatting characters', () => {
    for (const value of [undefined, null, 7, true, {}, [], ['Ada'], Symbol('Ada'), () => 'Ada']) expect(readCharacterName(value)).toEqual({ problem: 'not-text' });
    for (const value of ['', ' ', '   ', '\u00a0\u3000']) expect(readCharacterName(value)).toEqual({ problem: 'empty' });
    const forbidden = ['Ada\n', 'A\tda', 'Ada\u0000', 'Ada\u001b[31m', 'Ada\u007f', 'Ada\u2028', 'Ada\u2029', '\u202eadA', 'Ada\u2066', '\ufeffAda', 'A\u00adda', 'Ada\ud800', '\udc00Ada'];
    for (const value of forbidden) expect(readCharacterName(value)).toEqual({ problem: 'forbidden-character' });
    // Marks stacked on one letter: two are a real spelling, a pile is not.
    expect(readCharacterName('a\u0323\u0302')).toEqual({ name: '\u1ead' });
    expect(readCharacterName(`a${'\u0301'.repeat(8)}`)).toEqual({ problem: 'forbidden-character' });
  });

  it('refuses a name that shows nothing: the required name cannot be made of invisible characters', () => {
    // Zero-width joiners, blank letters (the Hangul fillers), variation selectors, the grapheme joiner, the braille blank, a private-use character, a bare mark.
    const invisible = ['\u200d', '\u200c', '\u200c\u200c', '\u200d \u200d', '\u3164', '\uffa0', '\u115f', '\u1160', '\ufe0f', '\ufe0e', '\u034f', '\u{e0100}', '\u17b4', '\u2800', '\ue000', '\u0301', ' \u0301'];
    for (const value of invisible) expect('name' in readCharacterName(value), JSON.stringify(value)).toBe(false);
  });

  it('refuses invisible characters that would make one name look exactly like another', () => {
    const twins = ['Julio\u200d', '\u200dJulio', 'Julio \u200d', 'Ju\u200d\u200dlio', 'Julio\ufe0f', 'Jul\u034fio', 'Julio\u3164', 'Julio \u0301'];
    for (const value of twins) expect(readCharacterName(value), JSON.stringify(value)).toEqual({ problem: 'forbidden-character' });
  });

  it('keeps the joiners and selectors real spellings need: emoji sequences, a keycap, a Persian word', () => {
    // A family, a heart on fire (selector then joiner), an astronaut with a skin tone, a keycap, and a zero-width non-joiner inside a Persian word.
    const spellings = ['\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', '\u2764\ufe0f\u200d\u{1f525}', '\u{1f469}\u{1f3fd}\u200d\u{1f680}', '1\ufe0f\u20e3 up', '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645'];
    for (const value of spellings) expect(readCharacterName(value), JSON.stringify(value)).toEqual({ name: value });
  });

  it('accepts everyday words of scripts that put several marks on one letter, and still refuses a pile', () => {
    // Burmese "city", Tibetan "accomplished" and pointed Hebrew "song": four or five marks on one visible character.
    const words = ['\u1019\u103c\u102d\u102f\u1037', '\u0f56\u0f66\u0f92\u0fb2\u0f74\u0f56\u0f66', '\u05e9\u05c1\u05b4\u05bc\u05d9\u05e8'];
    for (const value of words) expect('name' in readCharacterName(value), JSON.stringify(value)).toBe(true);
    // Marks kept apart by joiners are one visible character all the same, and Thai marks piled past any spelling are refused too.
    expect('name' in readCharacterName(`a${'\u030d\u030d\u200d'.repeat(13)}`)).toBe(false);
    expect(readCharacterName(`\u0e01${'\u0e49'.repeat(7)}`)).toEqual({ problem: 'forbidden-character' });
    expect(readCharacterName('a\u0307\u0308\u030a\u030b')).toEqual({ problem: 'forbidden-character' });
  });

  it('refuses the inputs the second review drew pixel-identical to another name, or blank', () => {
    // The object replacement character draws nothing; a joiner between Latin letters and a selector that selects nothing change no pixel.
    const blankOrTwin = [
      '\ufffc',
      'Julio\ufffc',
      'Jul\ufffcio',
      'Jul\u200dio',
      'Ju\u200clio',
      'J\u200du\u200dl\u200di\u200do',
      'a\u200d\u{1f525}',
      'Guest 1\ufe0e',
      'Guest 1\ufe0f',
      'Julio\u{1f600}\ufe0e',
      'Julio \u2764\ufe0e',
    ];
    for (const value of blankOrTwin) expect(readCharacterName(value), JSON.stringify(value)).toEqual({ problem: 'forbidden-character' });
    // Unassigned code points and noncharacters: nobody can say what they draw.
    for (const value of ['\u0e00', '\u0378', '\uffff', '\ufdd0', 'Ada\u181a']) expect('name' in readCharacterName(value), JSON.stringify(value)).toBe(false);
  });

  it('drops an emoji selector that selects nothing instead of storing a second spelling of the same name', () => {
    expect(readCharacterName('Julio\u{1f600}\ufe0f')).toEqual({ name: 'Julio\u{1f600}' });
    // After a symbol that would draw as text it does select something, and stays.
    expect(readCharacterName('Julio \u2764\ufe0f')).toEqual({ name: 'Julio \u2764\ufe0f' });
  });

  it('keeps the flags spelled with tag characters, Bengali ya-phala and a Persian word that ends in a digit', () => {
    // England's flag; "RAB" in Bengali (ra, joiner, virama, ya); a Persian name, a non-joiner, a Persian digit.
    const spellings = ['\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}', '\u09b0\u200d\u09cd\u09af\u09be\u09ac', '\u0639\u0644\u06cc\u200c\u06f2'];
    for (const value of spellings) expect(readCharacterName(value), JSON.stringify(value)).toEqual({ name: value });
    // Tag characters anywhere else stay refused, and so does a flag that never ends.
    expect(readCharacterName('Ada\u{e0067}')).toEqual({ problem: 'forbidden-character' });
    expect(readCharacterName('\u{1f3f4}\u{e0067}\u{e0062}')).toEqual({ problem: 'forbidden-character' });
  });
});

describe('readCharacter', () => {
  it('gives back a fresh, normalised character for a legal one', () => {
    const given = { name: ' Ada ', look: { skin: 1, hair: 2, clothes: 3, body: 0, hairStyle: 0 } };
    const read = readCharacter(given);
    expect(read).toEqual({ name: 'Ada', look: { skin: 1, hair: 2, clothes: 3, body: 0, hairStyle: 0 } });
    expect(read?.look).not.toBe(given.look);
  });

  it('accepts every palette index and nothing outside the palettes', () => {
    for (const part of ['skin', 'hair', 'clothes'] as const) {
      const size = characterPalettes[part].length;
      for (let index = 0; index < size; index += 1) expect(readCharacter(withLook({ [part]: index }))).toBeDefined();
      for (const index of [-1, size, size + 1, 0.5, NaN, Infinity, -Infinity, 2 ** 32, '0', null, undefined, [0], {}]) {
        expect(readCharacter(withLook({ [part]: index }))).toBeUndefined();
      }
    }
  });

  it('accepts every body type and hairstyle, in any pairing, and nothing outside the lists', () => {
    for (let body = 0; body < characterShapes.body.length; body += 1) {
      for (let hairStyle = 0; hairStyle < characterShapes.hairStyle.length; hairStyle += 1) {
        expect(readCharacter(withLook({ body, hairStyle }))?.look).toMatchObject({ body, hairStyle });
      }
    }
    for (const part of ['body', 'hairStyle'] as const) {
      const size = characterShapes[part].length;
      for (const index of [-1, size, size + 1, 0.5, NaN, Infinity, 2 ** 32, '0', null, undefined, [0], {}]) {
        expect(readCharacter(withLook({ [part]: index })), `${part} ${String(index)}`).toBeUndefined();
      }
    }
  });

  it('refuses a look without a body type or a hairstyle: the join and the change carry both', () => {
    const { skin, hair, clothes, body, hairStyle } = guestCharacter(0).look;
    const withoutBody = { skin, hair, clothes, hairStyle };
    const withoutHairStyle = { skin, hair, clothes, body };
    expect(readCharacter({ name: 'Ada', look: withoutBody })).toBeUndefined();
    expect(readCharacter({ name: 'Ada', look: withoutHairStyle })).toBeUndefined();
    expect(readCharacter({ name: 'Ada', look: { skin: 0, hair: 0, clothes: 0 } })).toBeUndefined();
  });

  it('refuses anything that is not exactly a name and a look', () => {
    const legal = guestCharacter(0);
    const notCharacters: unknown[] = [
      undefined,
      null,
      'Ada',
      7,
      [],
      [legal],
      {},
      { name: 'Ada' },
      { look: legal.look },
      { ...legal, slot: 3 },
      { ...legal, look: { ...legal.look, hat: 1 } },
      { ...legal, look: { skin: 0, hair: 0 } },
      { ...legal, look: [0, 0, 0] },
      { ...legal, look: null },
      { ...legal, name: 21 },
      { ...legal, name: 'a'.repeat(MAX_NAME_CHARACTERS + 1) },
      { ...legal, name: ['Ada'] },
    ];
    for (const value of notCharacters) expect(readCharacter(value)).toBeUndefined();
  });

  it('never throws, whatever it is handed', () => {
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    const throwingName = { look: guestCharacter(0).look, get name(): string { throw new Error('boom'); } };
    expect(readCharacter(throwing)).toBeUndefined();
    expect(readCharacter(throwingName)).toBeUndefined();
    expect(readCharacter({ name: 'Ada', look: throwing })).toBeUndefined();
  });

  it('seats guests as legal characters that differ from seat to seat', () => {
    const guests = [0, 1, 2, 3, 4].map((slot) => guestCharacter(slot));
    for (const guest of guests) expect(readCharacter(guest)).toEqual(guest);
    expect(new Set(guests.map((guest) => guest.name)).size).toBe(5);
    expect(new Set(guests.map((guest) => guest.look.clothes)).size).toBe(5);
    expect(readCharacter(guestCharacter(-1))).toBeDefined();
    expect(readCharacter(guestCharacter(Number.NaN))).toBeDefined();
  });
});

describe('readRememberedCharacter', () => {
  it('reads a character remembered before body types and hairstyles existed with the first of each', () => {
    expect(readRememberedCharacter({ name: 'Ada', look: { skin: 1, hair: 2, clothes: 3 } })).toEqual({ name: 'Ada', look: { skin: 1, hair: 2, clothes: 3, body: 0, hairStyle: 0 } });
  });

  it('reads a character remembered since then as it is, and refuses what readCharacter refuses', () => {
    const curvy: Character = { name: 'Bea', look: { skin: 0, hair: 1, clothes: 2, body: 1, hairStyle: 2 } };
    expect(readRememberedCharacter(curvy)).toEqual(curvy);
    const refused: unknown[] = [
      undefined,
      'Ada',
      { name: 'Ada', look: { skin: 99, hair: 0, clothes: 0 } },
      { name: '', look: { skin: 0, hair: 0, clothes: 0 } },
      { name: 'Ada', look: { skin: 0, hair: 0, clothes: 0, body: 1 } },
      { name: 'Ada', look: { skin: 0, hair: 0, clothes: 0, hairStyle: 1 } },
      { name: 'Ada', look: { skin: 0, hair: 0, clothes: 0, body: 9, hairStyle: 0 } },
      { name: 'Ada', look: { skin: 0, hair: 0, clothes: 0 }, slot: 1 },
    ];
    for (const value of refused) expect(readRememberedCharacter(value), JSON.stringify(value)).toBeUndefined();
  });

  it('never throws', () => {
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(readRememberedCharacter(throwing)).toBeUndefined();
    expect(readRememberedCharacter({ name: 'Ada', look: throwing })).toBeUndefined();
  });
});

describe('sameCharacter', () => {
  it('calls two characters the same when the name and every colour match', () => {
    expect(sameCharacter(ADA, { name: 'Ada', look: { skin: 1, hair: 2, clothes: 3, body: 0, hairStyle: 0 } })).toBe(true);
  });

  it('calls them different when the name or any one colour differs', () => {
    expect(sameCharacter(ADA, { ...ADA, name: 'ada' })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, skin: 0 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, hair: 0 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, clothes: 0 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, body: 1 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, hairStyle: 2 } })).toBe(false);
  });
});

describe('player/join with a character', () => {
  it('spawns the player with the look and the name it joined with', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const ada: Character = { name: 'Ada', look: { skin: 2, hair: 5, clothes: 7, body: 1, hairStyle: 0 } };
    const jose: Character = { name: 'José 🚀', look: { skin: 4, hair: 0, clothes: 1, body: 0, hairStyle: 2 } };
    sim.step([join(0, ada), join(1, jose)]);
    expect(characterInSlot(sim, 0)).toEqual(ada);
    expect(characterInSlot(sim, 1)).toEqual(jose);
    sim.destroy();
  });

  it('stores the normalised name, never the one the command carried', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0, { name: '  Ada   Lovelace ', look: { skin: 0, hair: 0, clothes: 0, body: 0, hairStyle: 0 } })]);
    expect(characterInSlot(sim, 0)?.name).toBe('Ada Lovelace');
    sim.destroy();
  });

  it('ignores a join whose character is not legal: nobody is seated and nothing throws', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const malformed: unknown[] = [
      // No character at all: the join every client sent before characters existed.
      { slot: 0, type: 'player/join' },
      { type: 'player/join', slot: 0, character: null },
      { type: 'player/join', slot: 0, character: 'Ada' },
      join(0, { name: 'a'.repeat(MAX_NAME_CHARACTERS + 1), look: guestCharacter(0).look }),
      join(0, { name: 21 as unknown as string, look: guestCharacter(0).look }),
      join(0, { name: '', look: guestCharacter(0).look }),
      join(0, { name: 'Ada\n', look: guestCharacter(0).look }),
      join(0, { name: 'Ada', look: { skin: characterPalettes.skin.length, hair: 0, clothes: 0, body: 0, hairStyle: 0 } }),
      join(0, { name: 'Ada', look: { skin: 0, hair: -1, clothes: 0, body: 0, hairStyle: 0 } }),
      join(0, { name: 'Ada', look: { skin: 0, hair: 0, clothes: 1.5, body: 0, hairStyle: 0 } }),
    ];
    for (const command of malformed) {
      expect(() => sim.step([command as Command])).not.toThrow();
      expect(findPlayerEntity(sim, 0)).toBeUndefined();
    }
    expect(players(sim)).toHaveLength(0);
    sim.destroy();
  });

  it('leaves nothing of a name behind when an entity id is used again by a shorter name', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0, { name: 'Bartholomew the Long', look: guestCharacter(0).look })]);
    const firstEid = findPlayerEntity(sim, 0);
    sim.step([{ type: 'player/leave', slot: 0 }]);
    sim.step([join(0, { name: 'Al', look: guestCharacter(1).look })]);
    expect(findPlayerEntity(sim, 0)).toBe(firstEid);
    expect(characterInSlot(sim, 0)).toEqual({ name: 'Al', look: guestCharacter(1).look });
    const stored = sim.snapshot().entities.find((entity) => entity.id === firstEid)?.components['PlayerName'] ?? {};
    expect(stored['length']).toBe(2);
    expect(Object.entries(stored).filter(([field, value]) => field !== 'length' && value !== 0)).toHaveLength(2);
    sim.destroy();
  });

  it('keeps the same seed and joins deterministic, and a different name a different state', async () => {
    const run = async (name: string): Promise<string> => {
      const sim = await createSimInternal({ seed: 9 });
      sim.step([join(0, { name, look: { skin: 1, hair: 1, clothes: 1, body: 0, hairStyle: 0 } })]);
      for (let tick = 0; tick < 30; tick += 1) sim.step([]);
      const hash = hashSnapshot(sim.snapshot());
      sim.destroy();
      return hash;
    };
    expect(await run('Ada')).toBe(await run('Ada'));
    expect(await run('Ada')).not.toBe(await run('Bea'));
  });

  it('reads no character for something that has none, or for an id that is no entity', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0, guestCharacter(0))]);
    // An entity that is not a player: it has a position and nothing of a character.
    const bystander = sim.createEntity();
    addComponent(sim.world, bystander, sim.store(Position));
    expect(getCharacter(sim, bystander)).toBeUndefined();
    for (const eid of [0, -1, 1.5, NaN, sim.capacity + 1, 2 ** 40]) expect(getCharacter(sim, eid)).toBeUndefined();
    sim.destroy();
  });
});

describe('a character on a replica', () => {
  it('arrives with the join, in a full state and in a delta, as plain numbers', async () => {
    const sim = await createSimInternal({ seed: 2 });
    const replica = createReplica({ map: sim.map, capacity: sim.capacity });
    const ada: Character = { name: 'Ada 🚀', look: { skin: 3, hair: 6, clothes: 2, body: 0, hairStyle: 0 } };
    sim.step([join(0, ada)]);
    const first = worldState(sim);
    expect(applyWorldState(replica, overTheWire(first))).toBe('applied');
    expect(characterInSlot(replica, 0)).toEqual(ada);
    const bea: Character = { name: 'Bea', look: { skin: 0, hair: 1, clothes: 5, body: 0, hairStyle: 0 } };
    sim.step([join(1, bea)]);
    const delta = diffWorldState(first, worldState(sim));
    // The name travels once: the delta carries the newcomer's and not a field of the player who was already there.
    expect(delta.changed.filter((change) => change.components['PlayerName'])).toHaveLength(1);
    expect(applyWorldState(replica, overTheWire(delta))).toBe('applied');
    expect(characterInSlot(replica, 0)).toEqual(ada);
    expect(characterInSlot(replica, 1)).toEqual(bea);
    sim.destroy();
  });

  it('shows a legal character whatever a server sends: an unreadable name is "?", a palette index out of range the first swatch', async () => {
    const sim = await createSimInternal({ seed: 2 });
    sim.step([join(0, { name: 'Ada', look: { skin: 1, hair: 1, clothes: 1, body: 0, hairStyle: 0 } })]);
    const honest = worldState(sim);
    const eid = findPlayerEntity(sim, 0) as number;
    const hostileNames: Record<string, number>[] = [
      { codePoint00: 0x110000 },
      { codePoint00: 0xd800 },
      { codePoint01: 0x202e },
      { codePoint01: 0x0a },
      { length: 0 },
      { length: 4_000_000_000 },
      { length: 3, codePoint00: 0x20, codePoint01: 0x20, codePoint02: 0x20 },
    ];
    for (const fields of hostileNames) {
      const replica = createReplica({ map: sim.map, capacity: sim.capacity });
      expect(applyWorldState(replica, tampered(honest, eid, 'PlayerName', fields))).toBe('applied');
      expect(getCharacter(replica, eid)?.name).toBe('?');
    }
    const replica = createReplica({ map: sim.map, capacity: sim.capacity });
    expect(applyWorldState(replica, tampered(honest, eid, 'PlayerLook', { skin: 99, hair: 4_000_000_000, clothes: characterPalettes.clothes.length, body: characterShapes.body.length, hairStyle: 4_000_000_000 }))).toBe('applied');
    expect(getCharacter(replica, eid)).toEqual({ name: 'Ada', look: { skin: 0, hair: 0, clothes: 0, body: 0, hairStyle: 0 } });
    sim.destroy();
  });
});

describe('player/change-character', () => {
  it('gives the same entity another look and name where it stands, and touches nobody else', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const ada: Character = { name: 'Ada', look: { skin: 2, hair: 5, clothes: 7, body: 0, hairStyle: 0 } };
    const jose: Character = { name: 'José 🚀', look: { skin: 4, hair: 0, clothes: 1, body: 0, hairStyle: 0 } };
    const grace: Character = { name: 'Grace Hopper', look: { skin: 0, hair: 3, clothes: 2, body: 1, hairStyle: 1 } };
    sim.step([join(0, ada), join(1, jose)]);
    // Walk away from the spawn first: a change that respawned the player would show.
    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let tick = 0; tick < 30; tick += 1) sim.step([]);
    sim.step([{ type: 'player/move', slot: 0, x: 0, y: 0 }]);
    sim.step([]);
    const before = playerInSlot(sim, 0);
    sim.step([change(0, grace)]);
    const after = playerInSlot(sim, 0);
    expect(characterInSlot(sim, 0)).toEqual(grace);
    expect(after).toEqual(before);
    expect(characterInSlot(sim, 1)).toEqual(jose);
    expect(players(sim)).toHaveLength(2);
    sim.destroy();
  });

  it('stores the normalised name and leaves nothing of a longer one behind', async () => {
    const sim = await createSimInternal({ seed: 1 });
    sim.step([join(0, { name: 'Bartholomew the Long', look: guestCharacter(0).look })]);
    sim.step([change(0, { name: '  Al ', look: guestCharacter(1).look })]);
    expect(characterInSlot(sim, 0)).toEqual({ name: 'Al', look: guestCharacter(1).look });
    const stored = sim.snapshot().entities.find((entity) => entity.id === findPlayerEntity(sim, 0))?.components['PlayerName'] ?? {};
    expect(stored['length']).toBe(2);
    expect(Object.entries(stored).filter(([field, value]) => field !== 'length' && value !== 0)).toHaveLength(2);
    sim.destroy();
  });

  it('ignores a change that is not legal, or for a seat nobody sits in: the world is exactly as it was', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const ada: Character = { name: 'Ada', look: { skin: 2, hair: 5, clothes: 7, body: 0, hairStyle: 0 } };
    sim.step([join(0, ada)]);
    const ignored: unknown[] = [
      { type: 'player/change-character', slot: 0 },
      { type: 'player/change-character', slot: 0, character: null },
      change(0, { name: '', look: ada.look }),
      change(0, { name: 'a'.repeat(21), look: ada.look }),
      change(0, { name: 'Bea', look: { ...ada.look, hair: 99 } }),
      change(0, withLook({ hat: 1 }) as Character),
      change(1, guestCharacter(1)),
      change(-1, guestCharacter(1)),
      change(0.5, guestCharacter(1)),
      { type: 'player/change-character', slot: '0', character: guestCharacter(1) },
      { type: 'player/change-character', character: guestCharacter(1) },
    ];
    for (const command of ignored) {
      expect(() => sim.step([command as Command]), JSON.stringify(command)).not.toThrow();
      expect(characterInSlot(sim, 0), JSON.stringify(command)).toEqual(ada);
      expect(players(sim)).toHaveLength(1);
    }
    sim.destroy();
  });

  it('reaches a replica as a delta of the same entity', async () => {
    const sim = await createSimInternal({ seed: 1 });
    const replica = createReplica({ capacity: sim.capacity });
    sim.step([join(0, { name: 'Ada', look: { skin: 2, hair: 5, clothes: 7, body: 0, hairStyle: 0 } })]);
    const joined = worldState(sim);
    applyWorldState(replica, overTheWire(joined));
    const grace: Character = { name: 'Grace 🚀', look: { skin: 0, hair: 3, clothes: 2, body: 0, hairStyle: 0 } };
    sim.step([change(0, grace)]);
    expect(applyWorldState(replica, overTheWire(diffWorldState(joined, worldState(sim))))).toBe('applied');
    expect(findPlayerEntity(replica, 0)).toBe(findPlayerEntity(sim, 0));
    expect(characterInSlot(replica, 0)).toEqual(grace);
    sim.destroy();
    replica.destroy();
  });

  it('keeps the same seed and commands deterministic', async () => {
    const run = async (): Promise<string> => {
      const sim = await createSimInternal({ seed: 9 });
      sim.step([join(0, guestCharacter(0))]);
      for (let tick = 0; tick < 10; tick += 1) sim.step([]);
      sim.step([change(0, { name: 'Bea', look: { skin: 1, hair: 1, clothes: 1, body: 0, hairStyle: 0 } })]);
      for (let tick = 0; tick < 10; tick += 1) sim.step([]);
      const hash = hashSnapshot(sim.snapshot());
      sim.destroy();
      return hash;
    };
    expect(await run()).toBe(await run());
  });
});

describe('fuzzing player/change-character', () => {
  it('never throws and never leaves an illegal character in the world, for thousands of hostile changes', async () => {
    const sim = await createSimInternal({ seed: 4 });
    const random = createRng(56);
    sim.step([join(0, guestCharacter(0))]);
    const eid = findPlayerEntity(sim, 0) as number;
    let current = guestCharacter(0);
    let changed = 0;
    for (let round = 0; round < 4000; round += 1) {
      const command = { type: 'player/change-character', slot: random.nextInt(8) === 0 ? pick(random, [-1, 1, 5, 0.5, '0', null, undefined]) : 0, character: hostileCharacter(random) };
      expect(() => sim.step([command as unknown as Command])).not.toThrow();
      const character = getCharacter(sim, eid) as Character;
      const asked = command.slot === 0 ? readCharacter(command.character) : undefined;
      // Either the change was legal and is what the rule made of it, or nothing changed at all.
      expect(character).toEqual(asked ?? current);
      expect(readCharacter(character)).toEqual(character);
      expectLegalByTheTicket(character);
      if (asked) changed += 1;
      current = character;
    }
    // The generator must reach both sides of the rule, or the loop above proves nothing.
    expect(changed).toBeGreaterThan(200);
    expect(changed).toBeLessThan(3800);
    expect(findPlayerEntity(sim, 0)).toBe(eid);
    expect(players(sim)).toHaveLength(1);
    sim.destroy();
  });
});

describe('fuzzing player/join', () => {
  it('never throws and never seats an illegal character, for thousands of hostile joins', async () => {
    const sim = await createSimInternal({ seed: 4 });
    const random = createRng(54);
    let seated = 0;
    for (let round = 0; round < 4000; round += 1) {
      const command = { type: 'player/join', slot: 0, character: hostileCharacter(random) };
      expect(() => sim.step([command as unknown as Command])).not.toThrow();
      const eid = findPlayerEntity(sim, 0);
      if (eid === undefined) continue;
      seated += 1;
      const character = getCharacter(sim, eid) as Character;
      // What is in the sim is legal by the sim's own rule, and it is what that rule made of the command's character.
      expect(readCharacter(character)).toEqual(character);
      expect(character).toEqual(readCharacter(command.character));
      expect(codePointsOf(character.name).length).toBeLessThanOrEqual(MAX_NAME_CODE_POINTS);
      // And by a rule written here, so that a weakened rule in the sim cannot vouch for itself.
      expectLegalByTheTicket(character);
      sim.step([{ type: 'player/leave', slot: 0 }]);
    }
    // The generator must reach both sides of the rule, or the loop above proves nothing.
    expect(seated).toBeGreaterThan(200);
    expect(seated).toBeLessThan(3800);
    expect(players(sim)).toHaveLength(0);
    sim.destroy();
  });

  it('reads back any name it accepted as the same name', () => {
    const random = createRng(55);
    let accepted = 0;
    for (let round = 0; round < 20_000; round += 1) {
      const read = readCharacterName(hostileName(random));
      if ('problem' in read) continue;
      accepted += 1;
      expect(readCharacterName(read.name)).toEqual({ name: read.name });
    }
    expect(accepted).toBeGreaterThan(1000);
  });
});

// ---- Helpers ----

const { createSimInternal } = __testing__;

const ADA: Character = { name: 'Ada', look: { skin: 1, hair: 2, clothes: 3, body: 0, hairStyle: 0 } };

function join(slot: number, character: Character): Command {
  return { type: 'player/join', slot, character };
}

function change(slot: number, character: Character): Command {
  return { type: 'player/change-character', slot, character };
}

/** Everything drawn of the player in `slot` but its character: which entity it is and where it stands. */
function playerInSlot(sim: Sim, slot: number): unknown {
  const eid = findPlayerEntity(sim, slot);
  return getRenderables(sim).find((renderable) => renderable.eid === eid);
}

function withLook(overrides: Record<string, unknown>): unknown {
  return { name: 'Ada', look: { skin: 0, hair: 0, clothes: 0, body: 0, hairStyle: 0, ...overrides } };
}

/** What the receiving end holds after a trip through JSON, like a real connection. */
function overTheWire<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T;
}

/** A copy of `state` with some fields of one component of one entity replaced, as a server that lies would send it. */
function tampered(state: WorldState, eid: number, component: string, fields: Record<string, number>): WorldState {
  const copy = JSON.parse(JSON.stringify(state)) as { entities: { id: number; components: Record<string, Record<string, number>> }[] };
  const entity = copy.entities.find((candidate) => candidate.id === eid);
  if (!entity) throw new Error(`no entity ${eid} in the state`);
  entity.components[component] = { ...entity.components[component], ...fields };
  return copy as unknown as WorldState;
}

/** What the ticket promises of any character in the world, checked without the sim's own rule. */
function expectLegalByTheTicket(character: Character): void {
  const visibleCharacters = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(character.name)].length;
  expect(visibleCharacters).toBeGreaterThanOrEqual(1);
  expect(visibleCharacters).toBeLessThanOrEqual(20);
  expect(character.name).not.toMatch(/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u);
  expect(character.name).toBe(character.name.trim());
  expect(character.name).toMatch(/[\p{L}\p{N}\p{S}\p{P}\p{Extended_Pictographic}]/u);
  for (const part of ['skin', 'hair', 'clothes'] as const) {
    expect(Number.isInteger(character.look[part])).toBe(true);
    expect(character.look[part]).toBeGreaterThanOrEqual(0);
    expect(character.look[part]).toBeLessThan(characterPalettes[part].length);
  }
  for (const part of ['body', 'hairStyle'] as const) {
    expect(Number.isInteger(character.look[part])).toBe(true);
    expect(character.look[part]).toBeGreaterThanOrEqual(0);
    expect(character.look[part]).toBeLessThan(characterShapes[part].length);
  }
}

function characterInSlot(sim: SimHandle, slot: number): Character | undefined {
  const eid = findPlayerEntity(sim, slot);
  return eid === undefined ? undefined : getCharacter(sim, eid);
}

function players(sim: Sim): unknown[] {
  return getRenderables(sim).filter((renderable) => isPlayerDefId(renderable.defId));
}

type Random = ReturnType<typeof createRng>;

function pick<T>(random: Random, values: readonly T[]): T {
  return values[random.nextInt(values.length)] as T;
}

/** Pieces a hostile name is built from: ordinary text, things that must be normalised, things that must be refused. */
const NAME_PIECES = ['a', 'Z', '\u00e9', 'e\u0301', '😀', '👨‍👩‍👧', '🇵🇪', ' ', '  ', '\u00a0', '\u3000', '\u0301', '\u200d', '日本', 'ß', '\n', '\t', '\u0000', '\u202e', '\ud800', '\ufeff', '\u2028'];

function hostileName(random: Random): unknown {
  const kind = random.nextInt(10);
  if (kind === 0) return pick(random, [undefined, null, 0, 21, true, {}, [], ['Ada'], { toString: () => 'Ada' }]);
  if (kind === 1) return 'x'.repeat(random.nextInt(200));
  // Mostly the benign pieces, so that a fair share of the names is legal.
  const pieces = random.nextInt(4) === 0 ? NAME_PIECES : NAME_PIECES.slice(0, 15);
  let name = '';
  const length = random.nextInt(26);
  for (let index = 0; index < length; index += 1) name += pick(random, pieces);
  return name;
}

/** Mostly a legal index (one in six is hostile), so that with five parts a fair share of the looks is still legal. */
function hostileIndex(random: Random, choices = 6): unknown {
  if (random.nextInt(6) !== 0) return random.nextInt(choices);
  return pick(random, [-1, 6, 7, 8, 9, 255, 2 ** 32, 0.5, NaN, Infinity, '1', null, undefined, {}, [1]]);
}

function hostileCharacter(random: Random): unknown {
  const kind = random.nextInt(12);
  if (kind === 0) return pick(random, [undefined, null, 'Ada', 3, [], { name: 'Ada' }, { look: {} }]);
  const look: Record<string, unknown> = { skin: hostileIndex(random), hair: hostileIndex(random), clothes: hostileIndex(random), body: hostileIndex(random, characterShapes.body.length), hairStyle: hostileIndex(random, characterShapes.hairStyle.length) };
  if (kind === 1) look['hat'] = 1;
  if (kind === 2) delete look['hair'];
  const character: Record<string, unknown> = { name: hostileName(random), look };
  if (kind === 3) character['slot'] = 4;
  return character;
}
