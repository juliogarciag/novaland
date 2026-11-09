import { Client, ErrorCode } from '@colyseus/sdk';
import { JOIN_REFUSAL, WIRE, type MoveMessage } from '@novaland/sim';
import { FULL_WORLD_RETRY_MS, JOIN_TIMEOUT_MS, RECONNECT_DELAYS_MS, WORLD_ROOM_ID } from './tuning';

/**
 * Where the client stands with the world server. The screens draw it, the
 * online world acts on it, the debug hooks expose it.
 */
export type ConnectionStatus =
  /** A join is in flight. `attempt` counts from 1 since the page loaded or the client was last seated. */
  | { readonly kind: 'connecting'; readonly attempt: number }
  /** Seated: the server welcomed this client into `slot`. */
  | { readonly kind: 'online'; readonly slot: number }
  /** Every seat is taken. The client asks again at `retryAt` (`Date.now()` milliseconds), or sooner on `retryNow`. */
  | { readonly kind: 'full'; readonly retryAt: number }
  /** The server is unreachable or the connection dropped. The client tries again at `retryAt`; `attempt` counts the connections that failed in a row, the dropped one included; a full world does not count. */
  | { readonly kind: 'disconnected'; readonly retryAt: number; readonly attempt: number }
  /** The server runs a world this client cannot show. Nothing is retried. */
  | { readonly kind: 'incompatible'; readonly reason: string };

/** What the online world does with what arrives. Payloads are untrusted: they come off the network as the server sent them. */
export interface WorldConnectionHandlers {
  /** A welcome arrived. `'seated'` when the client can play on this server; otherwise why it cannot, and the connection stops. */
  onWelcome(payload: unknown): 'seated' | { readonly incompatible: string };
  /** A `world/delta` or `world/state` arrived while seated. */
  onUpdate(payload: unknown): void;
  onStatus(status: ConnectionStatus): void;
}

/** The part of a joined room the connection uses. `joinWorldRoom` wraps the Colyseus SDK's room in it; tests fake it. */
export interface JoinedRoom {
  onMessage(type: string, callback: (payload: unknown) => void): void;
  onLeave(callback: (code: number) => void): void;
  send(type: string, payload?: unknown): void;
  leave(): Promise<number>;
}

export interface WorldConnectionOptions {
  /** `ws://host:port` or `http://host:port` of the world server. */
  readonly endpoint: string;
  readonly handlers: WorldConnectionHandlers;
  /** How to join the room at an endpoint. Default: the Colyseus SDK. Tests pass a fake. */
  readonly join?: (endpoint: string) => Promise<JoinedRoom>;
}

/**
 * One client's connection to the world room: joins, hands welcomes and
 * updates to the online world, and comes back by itself after a full world,
 * an unreachable server or a dropped connection. The SDK's own reconnection
 * is turned off: the server exposes no `reconnect` and keeps no session to
 * come back to (ADR 0005), so every return is a fresh join and a new seat.
 * Waiting is bounded by the client's own clock: a join that does not settle
 * or a room that never welcomes is abandoned, never waited on.
 */
export class WorldConnection {
  private currentStatus: ConnectionStatus = { kind: 'connecting', attempt: 0 };
  private readonly endpoint: string;
  private readonly handlers: WorldConnectionHandlers;
  private readonly join: (endpoint: string) => Promise<JoinedRoom>;
  /** Bumped on every attempt, on every abandoned room and on close, so callbacks of an earlier room are ignored. */
  private generation = 0;
  /** Joins started since the client was last seated. */
  private attempt = 0;
  /** Connections that failed in a row (unreachable, dropped, silent); picks the wait before the next one. A full world does not count. */
  private failedConnections = 0;
  private room: JoinedRoom | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private joinTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(options: WorldConnectionOptions) {
    this.endpoint = options.endpoint;
    this.handlers = options.handlers;
    this.join = options.join ?? joinWorldRoom;
  }

  /** Where the client stands. Only the connection moves it. */
  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /** Starts joining. Call once. */
  connect(): void {
    if (this.closed || this.generation > 0) return;
    void this.tryToJoin();
  }

  /** Tries again now instead of at the scheduled time (the screens' button). Does nothing while a join is in flight or once seated. */
  retryNow(): void {
    if (this.closed || this.status.kind === 'connecting' || this.status.kind === 'online' || this.status.kind === 'incompatible') return;
    this.clearRetry();
    void this.tryToJoin();
  }

  /** Sends the player's move intent. False (and nothing sent) unless seated. */
  sendMove(move: MoveMessage): boolean {
    if (this.status.kind !== 'online' || !this.room) return false;
    this.room.send(WIRE.move, { x: move.x, y: move.y });
    return true;
  }

  /** Asks the server for a full world state, after a delta that did not chain. */
  sendResync(): boolean {
    if (this.status.kind !== 'online' || !this.room) return false;
    this.room.send(WIRE.resync);
    return true;
  }

  /** Leaves for good: no retry, no more callbacks. */
  close(): void {
    this.closed = true;
    this.generation += 1;
    this.clearRetry();
    this.clearJoinTimer();
    const room = this.room;
    this.room = undefined;
    void room?.leave().catch(() => undefined);
  }

  private async tryToJoin(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.attempt += 1;
    this.setStatus({ kind: 'connecting', attempt: this.attempt });
    // The join and then the welcome share one clock: a server that accepts the socket and says nothing is abandoned, not waited for.
    this.joinTimer = setTimeout(() => this.abandon(generation), JOIN_TIMEOUT_MS);
    let room: JoinedRoom;
    try {
      room = await this.join(this.endpoint);
    } catch (error) {
      if (generation !== this.generation) return;
      this.clearJoinTimer();
      if (isWorldFullRefusal(error)) {
        this.failedConnections = 0;
        this.scheduleRetry({ kind: 'full', retryAt: Date.now() + FULL_WORLD_RETRY_MS }, FULL_WORLD_RETRY_MS);
      } else {
        this.failedConnections += 1;
        this.scheduleReconnect();
      }
      return;
    }
    if (generation !== this.generation) {
      void room.leave().catch(() => undefined);
      return;
    }
    this.room = room;
    room.onLeave(() => {
      if (generation !== this.generation) return;
      this.room = undefined;
      this.clearJoinTimer();
      this.failedConnections += 1;
      this.scheduleReconnect();
    });
    room.onMessage(WIRE.welcome, (payload) => {
      if (generation !== this.generation) return;
      this.clearJoinTimer();
      const outcome = this.handlers.onWelcome(payload);
      if (outcome === 'seated') {
        this.attempt = 0;
        this.failedConnections = 0;
        this.setStatus({ kind: 'online', slot: readSlot(payload) });
        return;
      }
      this.close();
      this.setStatus({ kind: 'incompatible', reason: outcome.incompatible });
    });
    const onUpdate = (payload: unknown): void => {
      if (generation === this.generation && this.status.kind === 'online') this.handlers.onUpdate(payload);
    };
    room.onMessage(WIRE.delta, onUpdate);
    room.onMessage(WIRE.state, onUpdate);
  }

  /** Gives up on the attempt `generation` (a join that never settled, a room that never welcomed): whatever it yields later is ignored, and the next attempt is scheduled. */
  private abandon(generation: number): void {
    if (generation !== this.generation || this.status.kind === 'online') return;
    this.generation += 1;
    this.joinTimer = undefined;
    const room = this.room;
    this.room = undefined;
    void room?.leave().catch(() => undefined);
    this.failedConnections += 1;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(Math.max(this.failedConnections, 1), RECONNECT_DELAYS_MS.length) - 1] as number;
    this.scheduleRetry({ kind: 'disconnected', retryAt: Date.now() + delay, attempt: this.failedConnections }, delay);
  }

  private scheduleRetry(status: ConnectionStatus, delayMs: number): void {
    if (this.closed) return;
    this.clearRetry();
    this.setStatus(status);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.tryToJoin();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== undefined) clearTimeout(this.joinTimer);
    this.joinTimer = undefined;
  }

  private setStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.handlers.onStatus(status);
  }
}

/**
 * Joins the world room at `endpoint` with the Colyseus SDK and wraps the room
 * in the small interface the connection uses. The SDK's automatic
 * reconnection is switched off before anything can drop (see the class).
 */
export async function joinWorldRoom(endpoint: string): Promise<JoinedRoom> {
  const room = await new Client(endpoint).joinById(WORLD_ROOM_ID);
  room.reconnection.enabled = false;
  return {
    onMessage: (type, callback) => {
      room.onMessage(type, callback);
    },
    onLeave: (callback) => {
      room.onLeave(callback);
    },
    send: (type, payload) => room.send(type, payload),
    leave: () => room.leave(true),
  };
}

/**
 * True when a refused join means every seat is taken: the matchmaker answers
 * `MATCHMAKE_INVALID_ROOM_ID` with "room ... is locked" for a room at
 * `maxClients` (the room never locks for any other reason), or the room's own
 * guard refused with `JOIN_REFUSAL.worldFull`. The same code with another
 * message ("not found") is a server still booting, which is retried like an
 * unreachable one.
 */
function isWorldFullRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== ErrorCode.MATCHMAKE_INVALID_ROOM_ID || typeof message !== 'string') return false;
  return /locked/i.test(message) || message.includes(JOIN_REFUSAL.worldFull);
}

/** The slot of a welcome the handlers accepted; they checked it is a non-negative integer. */
function readSlot(payload: unknown): number {
  return (payload as { slot: number }).slot;
}

export const __testing__ = { isWorldFullRefusal };
