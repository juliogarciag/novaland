import { describe, expect, it } from 'vitest';
import { MessageBudget, payloadLength, readMoveMessage } from './inbound';

describe('readMoveMessage', () => {
  it('accepts exactly { x, y } with finite numbers', () => {
    expect(readMoveMessage({ x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(readMoveMessage({ y: -0.5, x: 0.25 })).toEqual({ x: 0.25, y: -0.5 });
    expect(readMoveMessage({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('drops a payload that carries a slot or any other extra field', () => {
    expect(readMoveMessage({ x: 1, y: 0, slot: 3 })).toBeUndefined();
    expect(readMoveMessage({ x: 1, y: 0, type: 'player/move' })).toBeUndefined();
  });

  it('drops anything that is not an object with both fields', () => {
    for (const payload of [undefined, null, 1, 'x', true, [1, 0], {}, { x: 1 }, { y: 1 }, { x: 1, z: 0 }]) {
      expect(readMoveMessage(payload), JSON.stringify(payload)).toBeUndefined();
    }
  });

  it('drops values that are not finite numbers', () => {
    for (const payload of [{ x: '1', y: 0 }, { x: 1, y: null }, { x: NaN, y: 0 }, { x: 1, y: Infinity }, { x: -Infinity, y: 0 }, { x: 1n, y: 0 }]) {
      expect(readMoveMessage(payload), String(payload)).toBeUndefined();
    }
  });

  it('never throws, whatever comes in', () => {
    const hostile = [Object.create(null), new Map([['x', 1]]), { get x() { throw new Error('boom'); }, y: 0 }, Symbol('x'), () => 1];
    for (const payload of hostile) {
      expect(() => readMoveMessage(payload)).not.toThrow();
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

// ---- Helpers ----

/** How many of `attempts` messages the budget lets through at one instant. */
function allowedOf(budget: MessageBudget, nowMs: number, attempts: number): number {
  let allowed = 0;
  for (let i = 0; i < attempts; i += 1) {
    if (budget.allows(nowMs)) allowed += 1;
  }
  return allowed;
}
