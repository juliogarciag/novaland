import type { MoveMessage } from '@novaland/sim';

/**
 * The trust boundary at the network edge. What a session sends is decoded by
 * Colyseus and arrives here as an arbitrary value; only what matches the wire
 * contract exactly goes on to become a command, and the sim's own handlers
 * validate again. Nothing here throws on any input.
 */

/**
 * The `{ x, y }` of a `player/move` payload, or undefined when the payload is
 * anything else: not an object, missing a field, carrying an extra one (a
 * `slot`, say) or holding a value that is not a finite number.
 */
export function readMoveMessage(payload: unknown): MoveMessage | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const fields = payload as Record<string, unknown>;
  try {
    const keys = Object.keys(fields);
    if (keys.length !== 2 || !Object.hasOwn(fields, 'x') || !Object.hasOwn(fields, 'y')) return undefined;
    const { x, y } = fields;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x, y };
  } catch {
    // A decoded message is plain data, but a throwing accessor must still not reach the room.
    return undefined;
  }
}

/** Size of a decoded payload as JSON, in UTF-16 code units; Infinity when it cannot be serialised (a BigInt, a cycle). */
export function payloadLength(payload: unknown): number {
  if (payload === undefined) return 0;
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/**
 * A session's allowance of inbound messages: a bucket of `burst` tokens that
 * refills at `perSecond`. Each message spends one; a message with no token
 * left is dropped by the caller. Time is passed in so tests need no clock.
 */
export class MessageBudget {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    nowMs: number,
  ) {
    this.tokens = burst;
    this.refilledAt = nowMs;
  }

  /** True when a message may pass at `nowMs`, spending one token; false when the budget is spent. */
  allows(nowMs: number): boolean {
    const elapsedSeconds = Math.max(0, nowMs - this.refilledAt) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.perSecond);
    this.refilledAt = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
