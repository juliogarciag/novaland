import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { guestCharacter, readCharacter } from '@novaland/sim';
import { MessageBudget, payloadLength, readChangeCharacterMessage, readJoinCharacter, readMoveMessage, readPlayerKey, speaksProtocol } from './inbound';

describe('readJoinCharacter', () => {
  it('reads the character of the join options, normalised, and ignores the other fields', () => {
    const character = guestCharacter(2);
    expect(readJoinCharacter({ character })).toEqual(character);
    expect(readJoinCharacter({ character: { ...character, name: `  ${character.name} ` } })).toEqual(character);
    expect(readJoinCharacter({ character, token: 'someone-elses-field' })).toEqual(character);
  });

  it('gives nothing for options that hold no legal character', () => {
    const character = guestCharacter(0);
    const options: unknown[] = [
      undefined,
      null,
      'character',
      7,
      [],
      [{ character }],
      {},
      { Character: character },
      Object.create({ character }),
      { character: undefined },
      { character: { ...character, name: 21 } },
      { character: { ...character, name: 'a'.repeat(21) } },
      { character: { ...character, look: { ...character.look, skin: 6 } } },
      { character: { ...character, slot: 1 } },
    ];
    for (const value of options) expect(readJoinCharacter(value), JSON.stringify(value)).toBeUndefined();
  });

  it('never throws and only ever returns what the sim calls a legal character, for thousands of hostile options', () => {
    const hostile = [new Proxy({}, { has: () => { throw new Error('boom'); } }), { get character() { throw new Error('boom'); } }, Symbol('character'), () => ({ character: guestCharacter(0) })];
    for (const options of hostile) expect(readJoinCharacter(options)).toBeUndefined();
    let random = 54;
    const next = (bound: number): number => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % bound;
    };
    const pieces = ['a', 'Ada', ' ', '  ', '\u00e9', '😀', '\n', '\u0000', '\u202e', 'x'.repeat(30)];
    const values: unknown[] = [0, 1, 5, 6, 7, -1, 0.5, NaN, Infinity, '0', null, undefined, {}, [], true];
    let accepted = 0;
    for (let round = 0; round < 20_000; round += 1) {
      let name = '';
      for (let index = next(6); index > 0; index -= 1) name += pieces[next(pieces.length)];
      // Mostly legal indexes, so a fair share of the options passes and the check on what passes means something.
      const index = (): unknown => (next(5) === 0 ? values[next(values.length)] : next(6));
      const look: Record<string, unknown> = { skin: index(), hair: index(), clothes: index() };
      if (next(10) === 0) look['extra'] = 1;
      const character: Record<string, unknown> = { name: next(12) === 0 ? values[next(values.length)] : name, look };
      if (next(10) === 0) character['slot'] = 0;
      const read = readJoinCharacter(next(15) === 0 ? character : { character });
      if (!read) continue;
      accepted += 1;
      expect(readCharacter(read)).toEqual(read);
    }
    // The generator reaches both sides of the gate.
    expect(accepted).toBeGreaterThan(500);
    expect(accepted).toBeLessThan(19_500);
  });
});

describe('readChangeCharacterMessage', () => {
  it('accepts exactly { character } with a legal character, and returns it normalised', () => {
    const character = guestCharacter(2);
    expect(readChangeCharacterMessage({ character })).toEqual({ character });
    expect(readChangeCharacterMessage({ character: { ...character, name: `  ${character.name} ` } })).toEqual({ character });
  });

  it('drops a payload that carries a slot or any other field, and one with no legal character', () => {
    const character = guestCharacter(0);
    const payloads: unknown[] = [
      undefined,
      null,
      'character',
      7,
      [],
      [{ character }],
      {},
      character,
      { character, slot: 1 },
      { character, type: 'player/change-character' },
      { Character: character },
      Object.create({ character }),
      { character: undefined },
      { character: { ...character, name: 21 } },
      { character: { ...character, name: 'a'.repeat(21) } },
      { character: { ...character, look: { ...character.look, skin: 6 } } },
      { character: { ...character, slot: 1 } },
    ];
    for (const payload of payloads) expect(readChangeCharacterMessage(payload), JSON.stringify(payload)).toBeUndefined();
  });

  it('never throws and only ever returns what the sim calls a legal character, for thousands of hostile payloads', () => {
    const hostile = [new Proxy({}, { ownKeys: () => { throw new Error('boom'); } }), { get character() { throw new Error('boom'); } }, Symbol('character'), () => ({ character: guestCharacter(0) })];
    for (const payload of hostile) expect(readChangeCharacterMessage(payload)).toBeUndefined();
    let random = 56;
    const next = (bound: number): number => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % bound;
    };
    const pieces = ['a', 'Ada', ' ', '  ', '\u00e9', '😀', '\n', '\u0000', '\u202e', 'x'.repeat(30)];
    const values: unknown[] = [0, 1, 5, 6, 7, -1, 0.5, NaN, Infinity, '0', null, undefined, {}, [], true];
    let accepted = 0;
    for (let round = 0; round < 20_000; round += 1) {
      let name = '';
      for (let index = next(6); index > 0; index -= 1) name += pieces[next(pieces.length)];
      const index = (): unknown => (next(5) === 0 ? values[next(values.length)] : next(6));
      const look: Record<string, unknown> = { skin: index(), hair: index(), clothes: index() };
      if (next(10) === 0) look['extra'] = 1;
      const character: Record<string, unknown> = { name: next(12) === 0 ? values[next(values.length)] : name, look };
      const payload: Record<string, unknown> = { character };
      const extra = next(10) === 0;
      if (extra) payload['slot'] = 0;
      const read = readChangeCharacterMessage(next(15) === 0 ? character : payload);
      if (!read) continue;
      accepted += 1;
      expect(extra).toBe(false);
      expect(Object.keys(read)).toEqual(['character']);
      expect(readCharacter(read.character)).toEqual(read.character);
    }
    // The generator reaches both sides of the gate.
    expect(accepted).toBeGreaterThan(500);
    expect(accepted).toBeLessThan(19_500);
  });
});

describe('readMoveMessage', () => {
  it('accepts exactly { x, y, sequence } with finite numbers and a positive whole sequence', () => {
    expect(readMoveMessage({ x: 1, y: 0, sequence: 1 })).toEqual({ x: 1, y: 0, sequence: 1 });
    expect(readMoveMessage({ sequence: 9, y: -0.5, x: 0.25 })).toEqual({ x: 0.25, y: -0.5, sequence: 9 });
    expect(readMoveMessage({ x: 0, y: 0, sequence: Number.MAX_SAFE_INTEGER })).toEqual({ x: 0, y: 0, sequence: Number.MAX_SAFE_INTEGER });
  });

  it('drops a payload that carries a slot or any other extra field', () => {
    expect(readMoveMessage({ x: 1, y: 0, sequence: 1, slot: 3 })).toBeUndefined();
    expect(readMoveMessage({ x: 1, y: 0, sequence: 1, type: 'player/move' })).toBeUndefined();
  });

  it('drops anything that is not an object with the three fields', () => {
    for (const payload of [undefined, null, 1, 'x', true, [1, 0, 1], {}, { x: 1 }, { y: 1 }, { x: 1, y: 0 }, { x: 1, sequence: 1 }, { x: 1, z: 0, sequence: 1 }, { x: 1, y: 0, slot: 1 }]) {
      expect(readMoveMessage(payload), JSON.stringify(payload)).toBeUndefined();
    }
  });

  it('drops a direction that is not two finite numbers', () => {
    for (const payload of [{ x: '1', y: 0 }, { x: 1, y: null }, { x: NaN, y: 0 }, { x: 1, y: Infinity }, { x: -Infinity, y: 0 }, { x: 1n, y: 0 }]) {
      expect(readMoveMessage({ ...payload, sequence: 1 }), String(payload)).toBeUndefined();
    }
  });

  it('drops a sequence that is not a positive safe integer', () => {
    for (const sequence of [0, -1, 1.5, NaN, Infinity, 2 ** 53, '1', null, undefined, true, 1n, [1], { valueOf: () => 1 }]) {
      expect(readMoveMessage({ x: 1, y: 0, sequence }), String(sequence)).toBeUndefined();
    }
  });

  it('never throws, whatever comes in', () => {
    const hostile = [Object.create(null), new Map([['x', 1]]), { get x() { throw new Error('boom'); }, y: 0, sequence: 1 }, { x: 0, y: 0, get sequence() { throw new Error('boom'); } }, Symbol('x'), () => 1];
    for (const payload of hostile) {
      expect(() => readMoveMessage(payload)).not.toThrow();
    }
  });

  it('fuzzed with 20000 random payloads, never throws and only ever returns a well-formed move', () => {
    const random = seededRandom(45);
    for (let round = 0; round < 20000; round += 1) {
      const payload = randomPayload(random, 3);
      const move = readMoveMessage(payload);
      if (move === undefined) continue;
      expect(Object.keys(move).sort()).toEqual(['sequence', 'x', 'y']);
      expect(Number.isFinite(move.x) && Number.isFinite(move.y)).toBe(true);
      expect(Number.isSafeInteger(move.sequence) && move.sequence >= 1).toBe(true);
      expect(Object.keys(payload as object).sort()).toEqual(['sequence', 'x', 'y']);
    }
  });
});

describe('speaksProtocol', () => {
  it('is true only for options whose protocol is exactly that number', () => {
    expect(speaksProtocol({ protocol: 2 }, 2)).toBe(true);
    expect(speaksProtocol({ protocol: 2, extra: 'ignored' }, 2)).toBe(true);
    for (const options of [undefined, null, 2, '2', [], {}, { protocol: 1 }, { protocol: '2' }, { protocol: null }, { protocol: 2.5 }, { get protocol() { throw new Error('boom'); } }]) {
      expect(speaksProtocol(options, 2), String(options)).toBe(false);
    }
  });
});

describe('payloadLength', () => {
  it('measures a payload as JSON and treats the unserialisable as infinitely large', () => {
    expect(payloadLength(undefined)).toBe(0);
    expect(payloadLength({ x: 1, y: 0 })).toBe('{"x":1,"y":0}'.length);
    expect(payloadLength('a'.repeat(300))).toBe(302);
    expect(payloadLength({ n: 1n })).toBe(Infinity);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(payloadLength(cyclic)).toBe(Infinity);
  });
});

describe('MessageBudget', () => {
  it('allows a burst, then only the sustained rate', () => {
    const budget = new MessageBudget(10, 5, 0);
    expect(allowedOf(budget, 0, 20)).toBe(5);
    expect(budget.allows(0)).toBe(false);
    // Half a second later: 5 more tokens, capped by the burst.
    expect(allowedOf(budget, 500, 20)).toBe(5);
    // Two seconds later the bucket is full again, never more than the burst.
    expect(allowedOf(budget, 2500, 20)).toBe(5);
  });

  it('refills fractionally and ignores a clock that goes backwards', () => {
    const budget = new MessageBudget(10, 1, 1000);
    expect(budget.allows(1000)).toBe(true);
    expect(budget.allows(1050)).toBe(false); // half a token
    expect(budget.allows(1100)).toBe(true); // a whole one
    expect(budget.allows(500)).toBe(false); // backwards in time earns nothing
  });
});

describe('readPlayerKey', () => {
  it('turns a well-formed token into a key that is not the token, the same key every time', () => {
    const token = randomBytes(32).toString('base64url');
    const key = readPlayerKey({ protocol: 3, playerToken: token });
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).not.toBe(token);
    expect(readPlayerKey({ playerToken: token, anything: 'else' })).toBe(key);
    expect(readPlayerKey({ playerToken: randomBytes(32).toString('base64url') })).not.toBe(key);
  });

  it('reads no key from options without a token of exactly the right shape', () => {
    const token = randomBytes(32).toString('base64url');
    const notTokens: unknown[] = [undefined, null, '', 'x', 42, true, [], {}, token.slice(1), `${token}A`, `${token.slice(1)}=`, `${token.slice(1)}/`, `${token.slice(1)} `, [token], { toString: () => token }, new String(token), 'A'.repeat(1_000_000)];
    for (const playerToken of notTokens) expect(readPlayerKey({ playerToken }), String(playerToken).slice(0, 60)).toBeUndefined();
    for (const options of [undefined, null, token, 7, [token], () => token]) expect(readPlayerKey(options)).toBeUndefined();
    // Only an own or inherited `playerToken` field counts, never a field of another name.
    expect(readPlayerKey({ token, key: token, player: { playerToken: token } })).toBeUndefined();
  });

  it('fuzzed with 20000 random options, never throws and gives a key exactly when the token is well formed', () => {
    const random = seededRandom(55);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    for (let round = 0; round < 20000; round += 1) {
      const token = randomBytes(32).toString('base64url');
      const playerToken = random() < 0.3 ? token : pick([token.slice(Math.floor(random() * 5) + 1), token + token, token.replace(/.$/, pick(['=', '+', '/', ' ', '\u0000', 'é'])), randomPayload(random, 2)]);
      const options = random() < 0.9 ? { ...(randomPayload(random, 1) as object), playerToken } : randomPayload(random, 3);
      let key: string | undefined;
      expect(() => (key = readPlayerKey(options))).not.toThrow();
      const wellFormed = typeof options === 'object' && options !== null && typeof (options as { playerToken?: unknown }).playerToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test((options as { playerToken: string }).playerToken);
      expect(key !== undefined).toBe(wellFormed);
    }
    const throwing = Object.defineProperty({}, 'playerToken', { get: () => { throw new Error('a throwing accessor'); } });
    expect(readPlayerKey(throwing)).toBeUndefined();
  });
});

// ---- Helpers ----

/** How many of `attempts` messages the budget lets through at one instant. */
function allowedOf(budget: MessageBudget, nowMs: number, attempts: number): number {
  let allowed = 0;
  for (let i = 0; i < attempts; i += 1) {
    if (budget.allows(nowMs)) allowed += 1;
  }
  return allowed;
}

/** A small deterministic generator (mulberry32), so a failing fuzz round can be replayed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_KEYS = ['x', 'y', 'sequence', 'slot', 'type', '__proto__', 'constructor', ''];
const FUZZ_LEAVES: unknown[] = [0, 1, -1, 0.5, 1e308, -0, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_SAFE_INTEGER, 7, 12345, '1', '', 'player/move', null, undefined, true, false, 10n];

/** A random decoded payload: mostly objects built from the move's own field names, so many land near the valid shape. */
function randomPayload(random: () => number, depth: number): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const roll = random();
  if (depth === 0 || roll < 0.15) return pick(FUZZ_LEAVES);
  if (roll < 0.25) return Array.from({ length: Math.floor(random() * 4) }, () => randomPayload(random, depth - 1));
  const fields: Record<string, unknown> = {};
  const count = roll < 0.75 ? 3 : Math.floor(random() * 5);
  const keys = roll < 0.75 ? ['x', 'y', 'sequence'] : Array.from({ length: count }, () => pick(FUZZ_KEYS));
  for (const key of keys) Object.defineProperty(fields, key, { value: random() < 0.7 ? pick([0, 1, -1, 0.5, 3, 99, 1.5, 0, 2 ** 53, NaN]) : randomPayload(random, depth - 1), enumerable: true, configurable: true, writable: true });
  return fields;
}
