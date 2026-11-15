import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSavedPositions, SAVED_POSITIONS_FILE, type SavedPositions } from './savedPositions';
import { MAX_SAVED_PLAYERS } from './tuning';

describe('saved positions', () => {
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('gives back the last position saved for a player and nothing for a player it has never saved', () => {
    const store = open();
    expect(store.find('ana')).toBeUndefined();
    store.save('ana', { x: 1.5, y: -2.25 });
    store.save('ben', { x: 100, y: 200 });
    store.save('ana', { x: 3, y: 4 });
    expect(store.find('ana')).toEqual({ x: 3, y: 4 });
    expect(store.find('ben')).toEqual({ x: 100, y: 200 });
    expect(store.count).toBe(2);
  });

  it('keeps positions in memory without a directory, and on disk across a close and a reopen with one', () => {
    expect(open().kind).toBe('memory');
    const directory = temporaryDirectory();
    const first = open({ directory });
    expect(first.kind).toBe('disk');
    first.save('ana', { x: 7.25, y: 8.5 });
    first.close();
    const second = open({ directory });
    expect(second.count).toBe(1);
    expect(second.find('ana')).toEqual({ x: 7.25, y: 8.5 });
  });

  it('creates the directory when it is missing', () => {
    const directory = path.join(temporaryDirectory(), 'not', 'there', 'yet');
    const store = open({ directory });
    store.save('ana', { x: 1, y: 2 });
    expect(store.find('ana')).toEqual({ x: 1, y: 2 });
  });

  it(`remembers ${MAX_SAVED_PLAYERS} players by default and never more than its limit: one more forgets whoever was seen longest ago`, () => {
    let time = 1000;
    const store = open({ maxPlayers: 3, now: () => time });
    for (const player of ['ana', 'ben', 'cleo']) {
      store.save(player, { x: 0, y: 0 });
      time += 1000;
    }
    // Ana is seen again, so Ben is now the one seen longest ago.
    store.save('ana', { x: 9, y: 9 });
    time += 1000;
    store.save('dina', { x: 1, y: 1 });
    expect(store.count).toBe(3);
    expect(store.find('ben')).toBeUndefined();
    expect(store.find('ana')).toEqual({ x: 9, y: 9 });
    expect(store.find('cleo')).toBeDefined();
    expect(store.find('dina')).toBeDefined();
  });

  it('stays at its limit under a flood of 5000 players it has never seen', () => {
    let time = 0;
    const store = open({ maxPlayers: 50, now: () => (time += 1) });
    for (let player = 0; player < 5000; player += 1) store.save(`player-${player}`, { x: player, y: 0 });
    expect(store.count).toBe(50);
    expect(store.find('player-4999')).toEqual({ x: 4999, y: 0 });
    expect(store.find('player-0')).toBeUndefined();
  });

  it('cuts a file that holds more players than its limit down to the limit when it opens', () => {
    const directory = temporaryDirectory();
    let time = 0;
    const roomy = open({ directory, maxPlayers: 10, now: () => (time += 1) });
    for (let player = 0; player < 10; player += 1) roomy.save(`player-${player}`, { x: player, y: 0 });
    roomy.close();
    const tight = open({ directory, maxPlayers: 4 });
    expect(tight.count).toBe(4);
    expect(tight.find('player-9')).toBeDefined();
    expect(tight.find('player-5')).toBeUndefined();
  });

  it('does not save a position that is not two finite numbers', () => {
    const store = open();
    store.save('ana', { x: 1, y: 2 });
    for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: 0 }, { x: undefined, y: 0 }, { x: '1', y: 0 }, {}]) store.save('ana', position as { x: number; y: number });
    expect(store.find('ana')).toEqual({ x: 1, y: 2 });
  });

  it('refuses a limit that is not a positive whole number, a directory that is a file, and a file that is not a store', () => {
    expect(() => openSavedPositions({ maxPlayers: 0 })).toThrow(RangeError);
    expect(() => openSavedPositions({ maxPlayers: 1.5 })).toThrow(RangeError);
    const directory = temporaryDirectory();
    const file = path.join(directory, 'a-file');
    writeFileSync(file, 'not a directory');
    expect(() => openSavedPositions({ directory: file })).toThrow();
    writeFileSync(path.join(directory, SAVED_POSITIONS_FILE), 'this is not a database, however long it is. '.repeat(100));
    expect(() => openSavedPositions({ directory })).toThrow();
  });

  it('once closed, finds nothing and saves nothing, without throwing', () => {
    const store = open();
    store.save('ana', { x: 1, y: 2 });
    store.close();
    expect(store.find('ana')).toBeUndefined();
    expect(() => store.save('ana', { x: 3, y: 4 })).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });

  it('logs a save that fails at most once a minute, without the key, and never throws', () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => void logged.push(String(line)));
    let time = 0;
    // A key SQLite cannot bind makes every save fail, as a full disk would.
    const unbindable = { secret: 'ana' } as unknown as string;
    const store = open({ now: () => time });
    for (let attempt = 0; attempt < 5; attempt += 1) expect(() => store.save(unbindable, { x: 1, y: 2 })).not.toThrow();
    expect(logged).toHaveLength(1);
    time += 60_000;
    store.save(unbindable, { x: 1, y: 2 });
    expect(logged).toHaveLength(2);
    expect(JSON.parse(logged[0] as string)).toMatchObject({ event: 'saved-positions-failed' });
    expect(logged.join()).not.toContain('ana');
    expect(store.count).toBe(0);
  });
});

// ---- Helpers ----

const stores: SavedPositions[] = [];
const directories: string[] = [];

function open(options: Parameters<typeof openSavedPositions>[0] = {}): SavedPositions {
  const store = openSavedPositions(options);
  stores.push(store);
  return store;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'novaland-saved-positions-'));
  directories.push(directory);
  return directory;
}
