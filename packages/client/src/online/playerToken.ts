import { isPlayerToken } from '@novaland/sim';

/** Where the browser keeps the player token. */
export const PLAYER_TOKEN_STORAGE_KEY = 'novaland.playerToken';

/** The part of `localStorage` the token needs; tests pass a fake. */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A token this page made up and could not store: it still names the player until the page is closed. */
let unstoredToken: string | undefined;

/**
 * The secret this browser presents when it joins, so the server puts the
 * player back where they left (ADR 0014). There are no accounts: the token is
 * 32 random bytes the browser makes up the first time and keeps in
 * `localStorage`, so every tab of this browser is the same player and
 * clearing the site's data makes a new one. A stored value that is not a
 * token is replaced. When the storage cannot be read or written (a private
 * window that refuses it), the page keeps one token for as long as it lives.
 *
 * It is a credential: it goes into the join and nowhere else. It is not on
 * `window.__novaland`, not drawn and not logged.
 */
export function readOrCreatePlayerToken(storage: TokenStorage | undefined = browserStorage()): string {
  try {
    const stored = storage?.getItem(PLAYER_TOKEN_STORAGE_KEY);
    if (isPlayerToken(stored)) return stored;
  } catch {
    // Unreadable storage: fall through to a token of this page's own.
  }
  const token = unstoredToken ?? createPlayerToken();
  try {
    if (!storage) throw new Error('no storage');
    storage.setItem(PLAYER_TOKEN_STORAGE_KEY, token);
    unstoredToken = undefined;
  } catch {
    unstoredToken = token;
  }
  return token;
}

/** 32 bytes from the browser's cryptographic generator, as base64url without padding: what `isPlayerToken` accepts. */
function createPlayerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** The page's `localStorage`, or undefined where reaching for it throws (storage blocked) or there is none. */
function browserStorage(): TokenStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const __testing__ = {
  forgetUnstoredToken: (): void => {
    unstoredToken = undefined;
  },
};
