import type { JoinedRoom } from './connection';

/**
 * A test double for the room the connection joins: records what the client
 * sends, lets a test deliver messages and drop the connection. Used by the
 * connection and online-world tests; nothing in the app imports it.
 */
export class FakeRoom implements JoinedRoom {
  readonly sent: Array<{ readonly type: string; readonly payload: unknown }> = [];
  left = false;
  /** False for a room whose server never closes the socket after `leave()`: `onLeave` then never fires. */
  closesOnLeave = true;
  private readonly messageHandlers = new Map<string, (payload: unknown) => void>();
  private readonly leaveHandlers: Array<(code: number) => void> = [];

  onMessage(type: string, callback: (payload: unknown) => void): void {
    this.messageHandlers.set(type, callback);
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveHandlers.push(callback);
  }

  send(type: string, payload?: unknown): void {
    this.sent.push({ type, payload });
  }

  /** A consented leave: the client asked and, unless the server is silent, the room closes with 4000. */
  leave(): Promise<number> {
    this.left = true;
    if (this.closesOnLeave) this.drop(4000);
    return new Promise(() => undefined);
  }

  /** The server sent a message. */
  receive(type: string, payload: unknown): void {
    this.messageHandlers.get(type)?.(payload);
  }

  /** The connection closed with `code` (1006: the server went away). */
  drop(code = 1006): void {
    for (const callback of this.leaveHandlers.splice(0)) callback(code);
  }

  /** Message types the client sent, in order. */
  get sentTypes(): string[] {
    return this.sent.map((message) => message.type);
  }
}

/** What one join attempt does: hands out a room, fails the way the SDK fails, or never settles. */
export type JoinOutcome = 'room' | 'full' | 'unreachable' | 'booting' | 'hangs';

/**
 * A `join` for the connection that plays a script of outcomes, one per
 * attempt (the last one repeats), and keeps every room it handed out.
 */
export function scriptedJoin(outcomes: readonly JoinOutcome[]): { join: (endpoint: string) => Promise<JoinedRoom>; rooms: FakeRoom[]; endpoints: string[] } {
  const rooms: FakeRoom[] = [];
  const endpoints: string[] = [];
  return {
    rooms,
    endpoints,
    join: (endpoint) => {
      endpoints.push(endpoint);
      const outcome = outcomes[Math.min(endpoints.length, outcomes.length) - 1];
      switch (outcome) {
        case 'full':
          return Promise.reject(matchMakeError('room "world" is locked'));
        case 'booting':
          return Promise.reject(matchMakeError('room "world" not found'));
        case 'unreachable':
          return Promise.reject(new TypeError('Failed to fetch'));
        case 'hangs':
          return new Promise(() => undefined);
        default: {
          const room = new FakeRoom();
          rooms.push(room);
          return Promise.resolve(room);
        }
      }
    },
  };
}

/** Shaped like the SDK's MatchMakeError for a refused joinById: code 522 (MATCHMAKE_INVALID_ROOM_ID). */
export function matchMakeError(message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code: 522 });
}
