import { readCharacter, type Character, type MoveMessage } from '@novaland/sim';

/**
 * The trust boundary at the network edge. What a session sends is decoded by
 * Colyseus and arrives here as an arbitrary value; only what matches the wire
 * contract exactly goes on to become a command, and the sim's own handlers
 * validate again. Nothing here throws on any input.
 */

/**
 * The `{ x, y, sequence }` of a `player/move` payload, or undefined when the
 * payload is anything else: not an object, missing a field, carrying an extra
 * one (a `slot`, say), holding an `x` or `y` that is not a finite number or a
 * `sequence` that is not a positive safe integer.
 */
export function readMoveMessage(payload: unknown): MoveMessage | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const fields = payload as Record<string, unknown>;
  try {
    const keys = Object.keys(fields);
    if (keys.length !== 3 || !Object.hasOwn(fields, 'x') || !Object.hasOwn(fields, 'y') || !Object.hasOwn(fields, 'sequence')) return undefined;
    const { x, y, sequence } = fields;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) return undefined;
    return { x, y, sequence: sequence as number };
  } catch {
    // A decoded message is plain data, but a throwing accessor must still not reach the room.
    return undefined;
  }
}

/** True when the options of a join name the wire protocol `protocol`: an object whose `protocol` is that number. Anything else, a join with no options included, was built against another contract. */
export function speaksProtocol(options: unknown, protocol: number): boolean {
  if (typeof options !== 'object' || options === null) return false;
  try {
    return (options as { protocol?: unknown }).protocol === protocol;
  } catch {
    return false;
  }
}

/**
 * The character in the options of a join request, as the sim would store it
 * (`readCharacter`: a legal look, a normalised name), or undefined when the
 * options hold no legal one. Only `character` is read: other fields of the
 * options belong to whoever added them and are neither trusted nor refused
 * here.
 */
export function readJoinCharacter(options: unknown): Character | undefined {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return undefined;
  try {
    if (!Object.hasOwn(options, 'character')) return undefined;
    return readCharacter((options as Record<string, unknown>)['character']);
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
