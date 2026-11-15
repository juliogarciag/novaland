import { isPlayerToken, PLAYER_TOKEN_LENGTH } from '@novaland/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { __testing__, PLAYER_TOKEN_STORAGE_KEY, readOrCreatePlayerToken, type TokenStorage } from './playerToken';

describe('readOrCreatePlayerToken', () => {
  beforeEach(() => {
    __testing__.forgetUnstoredToken();
  });

  it('makes up a token the first time, stores it, and gives the same one from then on', () => {
    const storage = memoryStorage();
    const token = readOrCreatePlayerToken(storage);
    expect(isPlayerToken(token)).toBe(true);
    expect(token).toHaveLength(PLAYER_TOKEN_LENGTH);
    expect(storage.items.get(PLAYER_TOKEN_STORAGE_KEY)).toBe(token);
    expect(readOrCreatePlayerToken(storage)).toBe(token);
  });

  it('makes a different token for every browser', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => readOrCreatePlayerToken(memoryStorage())));
    expect(tokens.size).toBe(200);
  });

  it('replaces a stored value that is not a token', () => {
    for (const stored of ['', 'hello', 'A'.repeat(PLAYER_TOKEN_LENGTH - 1), 'A'.repeat(PLAYER_TOKEN_LENGTH + 1), `${'A'.repeat(PLAYER_TOKEN_LENGTH - 1)}=`, '{"x":1,"y":2}']) {
      const storage = memoryStorage({ [PLAYER_TOKEN_STORAGE_KEY]: stored });
      const token = readOrCreatePlayerToken(storage);
      expect(isPlayerToken(token), stored).toBe(true);
      expect(storage.items.get(PLAYER_TOKEN_STORAGE_KEY)).toBe(token);
    }
  });

  it('keeps one token for the life of the page when the storage refuses to be read or written, or there is none', () => {
    const refusing: TokenStorage = {
      getItem: () => {
        throw new Error('storage is blocked');
      },
      setItem: () => {
        throw new Error('storage is blocked');
      },
    };
    const token = readOrCreatePlayerToken(refusing);
    expect(isPlayerToken(token)).toBe(true);
    expect(readOrCreatePlayerToken(refusing)).toBe(token);
    expect(readOrCreatePlayerToken(undefined)).toBe(token);
    // Once a storage takes it, that token is the one that is kept.
    const storage = memoryStorage();
    expect(readOrCreatePlayerToken(storage)).toBe(token);
    expect(storage.items.get(PLAYER_TOKEN_STORAGE_KEY)).toBe(token);
  });
});

// ---- Helpers ----

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}
