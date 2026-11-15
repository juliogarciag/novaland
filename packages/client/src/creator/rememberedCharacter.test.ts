import { guestCharacter } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { CHARACTER_STORAGE_KEY, readRememberedCharacter, rememberCharacter, type CharacterStorage } from './rememberedCharacter';

describe('the remembered character', () => {
  it('comes back as it was remembered', () => {
    const storage = fakeStorage();
    const character = { name: 'José 🚀', look: { skin: 4, hair: 0, clothes: 6 } };
    rememberCharacter(storage, character);
    expect(readRememberedCharacter(storage)).toEqual(character);
  });

  it('is nothing on a first visit', () => {
    expect(readRememberedCharacter(fakeStorage())).toBeUndefined();
    expect(readRememberedCharacter(undefined)).toBeUndefined();
  });

  it('is nothing when what the browser holds is not a legal character any more', () => {
    const legal = guestCharacter(0);
    const stale: string[] = [
      '',
      'not json',
      'null',
      '[]',
      JSON.stringify({ name: legal.name }),
      JSON.stringify({ ...legal, name: 'a'.repeat(21) }),
      JSON.stringify({ ...legal, name: '' }),
      JSON.stringify({ ...legal, look: { ...legal.look, hair: 99 } }),
      JSON.stringify({ ...legal, extra: true }),
    ];
    for (const stored of stale) expect(readRememberedCharacter(fakeStorage({ [CHARACTER_STORAGE_KEY]: stored })), stored).toBeUndefined();
  });

  it('never throws when the browser denies storage', () => {
    const denied: CharacterStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readRememberedCharacter(denied)).toBeUndefined();
    expect(() => rememberCharacter(denied, guestCharacter(0))).not.toThrow();
    expect(() => rememberCharacter(undefined, guestCharacter(0))).not.toThrow();
  });
});

// ---- Helpers ----

function fakeStorage(initial: Record<string, string> = {}): CharacterStorage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}
