import {
  createSim,
  diffWorldState,
  FIXED_DT,
  JOIN_REFUSAL,
  WIRE,
  worldState,
  type Command,
  type SimHandle,
  type WelcomeMessage,
  type WorldState,
  type WorldStateDelta,
} from '@novaland/sim';
import { ClientState, CloseCode, ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { MessageBudget, payloadLength, readMoveMessage } from './inbound';
import { IDLE_KICK } from './kicks';
import { Seats } from './seats';
import { takeWholeTicks } from './takeWholeTicks';
import {
  DISCONNECT_MESSAGES_PER_SECOND,
  IDLE_TIMEOUT_MS,
  INBOUND_BURST,
  INBOUND_MESSAGES_PER_SECOND,
  JOIN_ACK_TIMEOUT_MS,
  LOOP_INTERVAL_MS,
  MAX_CATCH_UP_SECONDS,
  MAX_INBOUND_BYTES,
  MAX_SEATS,
  RESYNC_BURST,
  RESYNCS_PER_SECOND,
  SEAT_RESERVATION_SECONDS,
  TICKS_PER_SEND,
  WORLD_ROOM_ID,
} from './tuning';

/** Where the room reads the time: milliseconds from a fixed point, like `performance.now()`. Every timeout in the room is measured on it, so a fake clock can run one in a test. */
export interface Clock {
  now(): number;
}

/** What the boot passes to `matchMaker.createRoom`. Clients cannot create rooms (see startWorldServer). */
export interface WorldRoomOptions {
  /** Seed of the one sim. The boot draws a random one; a test pins it. */
  readonly seed: number;
  /** Milliseconds a session may go without an accepted input before its seat is freed; `IDLE_TIMEOUT_MS` unless set. */
  readonly idleTimeoutMs?: number;
  /** The clock the room reads; `performance.now` unless a test passes a fake. */
  readonly clock?: Clock;
}

/** What the room knows about one connected session. */
interface Session {
  readonly slot: number;
  /** The last world state sent to this session, so the next delta chains from it. Unset until the welcome. */
  lastSent: WorldState | undefined;
  /** When the welcome went out; a session that has not acknowledged the join `JOIN_ACK_TIMEOUT_MS` later is closed. */
  welcomedAt: number | undefined;
  /** Set by `world/resync`: the next send carries a full state instead of a delta. */
  wantsFullState: boolean;
  /** When the session's last input passed the edge gate (its join counts as one); `idleTimeoutMs` after it the seat is freed. */
  lastInputAt: number;
  readonly budget: MessageBudget;
  readonly resyncBudget: MessageBudget;
}

/** Messages the room dropped at the edge, by reason. Printed when the server stops; never logged per message. */
export interface DroppedMessages {
  unknownType: number;
  oversized: number;
  malformed: number;
  overBudget: number;
}

/**
 * The world: one authoritative sim, five seats, created once at boot and
 * joined by id (ADR 0004, 0005). The room is the only thing that steps the
 * sim, one whole tick of `FIXED_DT` at a time as real time earns them.
 * Sessions get a seat (`slot`) on join and lose it on leave; the sim sees
 * that as `player/join` and `player/leave`. Inbound messages pass the edge
 * gate in `inbound.ts` (allow-list, budget, size, exact shape) and leave it
 * stamped with the session's slot; the sim's own handlers validate again.
 * Outbound, each session gets a full state in its welcome and then a delta
 * every `TICKS_PER_SEND` ticks, diffed from the last state sent to it. A
 * session that sends no accepted input for `idleTimeoutMs` is closed with
 * `IDLE_KICK` so its seat goes to someone who plays (#22).
 */
export class WorldRoom extends Room {
  override maxClients = MAX_SEATS;
  /** The world outlives its players: an empty room stays up. */
  override autoDispose = false;
  override maxMessagesPerSecond = DISCONNECT_MESSAGES_PER_SECOND;
  override seatReservationTimeout = SEAT_RESERVATION_SECONDS;

  readonly dropped: DroppedMessages = { unknownType: 0, oversized: 0, malformed: 0, overBudget: 0 };
  /** Sessions closed with `IDLE_KICK` since the room was created. Printed when the server stops. */
  idleSeatsFreed = 0;

  private sim: SimHandle | undefined;
  /** Not Colyseus's `clock` (a timer scheduler): only where the room reads the time. */
  private time: Clock = { now: () => performance.now() };
  private idleTimeoutMs = IDLE_TIMEOUT_MS;
  private readonly seats = new Seats(MAX_SEATS);
  private readonly sessions = new Map<string, Session>();
  private pendingCommands: Command[] = [];
  private tickWaiters: Array<(ticked: boolean) => void> = [];
  private leftover = 0;
  private wokeAt = 0;
  private lastSendTick = 0;
  private loop: NodeJS.Timeout | undefined;

  /** The sim's tick; 0 before the room is created. */
  get tick(): number {
    return this.sim?.tick ?? 0;
  }

  get seatsTaken(): number {
    return this.seats.taken;
  }

  override async onCreate(options: WorldRoomOptions): Promise<void> {
    this.roomId = WORLD_ROOM_ID;
    if (options.clock) this.time = options.clock;
    if (options.idleTimeoutMs !== undefined) {
      // The boot refuses a bad IDLE_TIMEOUT_SECONDS the same way: a typo must never silently become ten minutes, or zero.
      if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) throw new RangeError(`idleTimeoutMs must be a positive number of milliseconds, got ${String(options.idleTimeoutMs)}`);
      this.idleTimeoutMs = options.idleTimeoutMs;
    }
    this.sim = await createSim({ seed: options.seed });
    this.onMessage(WIRE.move, (client, payload: unknown) => this.onMove(client, payload));
    this.onMessage(WIRE.resync, (client) => this.onResync(client));
    this.onMessage('*', (client) => this.onUnknownMessage(client));
    this.wokeAt = this.time.now();
    this.loop = setInterval(() => this.advance(), LOOP_INTERVAL_MS);
  }

  /**
   * Seats the session and welcomes it with the state after the tick that
   * spawned its player, so the client finds its own entity in it. The
   * matchmaker refuses a sixth join before this runs (`maxClients`, ADR
   * 0005); the refusal here is the guard behind it.
   */
  override async onJoin(client: Client): Promise<void> {
    const slot = this.seats.claim(client.sessionId);
    if (slot === undefined) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, JOIN_REFUSAL.worldFull);
    const now = this.time.now();
    const session: Session = {
      slot,
      lastSent: undefined,
      welcomedAt: undefined,
      wantsFullState: false,
      lastInputAt: now,
      budget: new MessageBudget(INBOUND_MESSAGES_PER_SECOND, INBOUND_BURST, now),
      resyncBudget: new MessageBudget(RESYNCS_PER_SECOND, RESYNC_BURST, now),
    };
    this.sessions.set(client.sessionId, session);
    this.pendingCommands.push({ type: 'player/join', slot });
    const ticked = await this.afterNextTick();
    if (!ticked || !this.sim) throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, 'the world is shutting down');
    const state = worldState(this.sim);
    session.lastSent = state;
    session.welcomedAt = this.time.now();
    const welcome: WelcomeMessage = { slot, level: this.sim.level.name, capacity: this.sim.capacity, state };
    client.send(WIRE.welcome, welcome);
  }

  /** Frees the seat; the sim removes the player on the next tick. Runs for consented and dropped connections alike, and after a kick, which freed the seat already. */
  override onLeave(client: Client): void {
    this.freeSeat(client);
  }

  /** The session's seat, free, and `player/leave` queued for its slot; nothing when the session holds no seat any more. */
  private freeSeat(client: Client): void {
    const slot = this.seats.release(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (slot !== undefined) this.pendingCommands.push({ type: 'player/leave', slot });
  }

  /** Stops the loop, wakes any join still waiting for a tick (it fails: no tick is coming) and frees the sim. */
  override onDispose(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
    this.settleTickWaiters(false);
    this.sim?.destroy();
    this.sim = undefined;
  }

  /**
   * Runs the ticks real time has earned since the last wake-up, then a send
   * if one is due. A throw here is a bug in the sim or in the room, not
   * something a client can cause: it is logged with what a replay needs,
   * then rethrown so the process dies loudly and whatever supervises it
   * restarts a fresh world.
   */
  private advance(): void {
    const sim = this.sim;
    if (!sim) return;
    const now = this.time.now();
    const { ticks, leftover } = takeWholeTicks({
      leftover: this.leftover,
      deltaSeconds: (now - this.wokeAt) / 1000,
      dt: FIXED_DT,
      maxFrameSeconds: MAX_CATCH_UP_SECONDS,
    });
    this.wokeAt = now;
    this.leftover = leftover;
    try {
      for (let tick = 0; tick < ticks; tick += 1) {
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        sim.step(commands);
        this.settleTickWaiters(true);
      }
      if (sim.tick - this.lastSendTick >= TICKS_PER_SEND) {
        this.lastSendTick = sim.tick;
        this.sendWorldUpdates(sim, now);
        this.freeIdleSeats(now);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'world-room-crashed', seed: sim.seed, tick: sim.tick, error: String(error) }));
      throw error;
    }
  }

  /** Resolves after the next tick with true, so a command queued before the call has been applied; with false if the room is disposed first. */
  private afterNextTick(): Promise<boolean> {
    return new Promise((resolve) => this.tickWaiters.push(resolve));
  }

  private settleTickWaiters(ticked: boolean): void {
    const waiters = this.tickWaiters;
    this.tickWaiters = [];
    for (const resolve of waiters) resolve(ticked);
  }

  /**
   * One update to every welcomed session: a full state to those that asked
   * for one, a delta from the last state sent to each of the others. Sessions
   * that last saw the same tick share one diff. A session that has not yet
   * acknowledged its join cannot receive anything (Colyseus would buffer it
   * without bound), so it gets nothing until it can; one that stays
   * unacknowledged past `JOIN_ACK_TIMEOUT_MS` is closed.
   */
  private sendWorldUpdates(sim: SimHandle, now: number): void {
    const next = worldState(sim);
    const deltaByFromTick = new Map<number, WorldStateDelta>();
    for (const client of this.clients) {
      const session = this.sessions.get(client.sessionId);
      if (!session?.lastSent) continue;
      if (client.state !== ClientState.JOINED) {
        // Nothing is sent, and `lastSent` stays at the welcome, so the first delta after the acknowledgement chains from it.
        if (session.welcomedAt !== undefined && now - session.welcomedAt > JOIN_ACK_TIMEOUT_MS) client.leave(CloseCode.WITH_ERROR);
        continue;
      }
      if (session.wantsFullState) {
        session.wantsFullState = false;
        session.lastSent = next;
        client.send(WIRE.state, next);
        continue;
      }
      let delta = deltaByFromTick.get(session.lastSent.tick);
      if (!delta) {
        delta = diffWorldState(session.lastSent, next);
        deltaByFromTick.set(session.lastSent.tick, delta);
      }
      session.lastSent = next;
      client.send(WIRE.delta, delta);
    }
  }

  /**
   * Frees the seat of every session whose last accepted input is
   * `idleTimeoutMs` or more behind `now`, then closes it; the close reaches
   * the client as `IDLE_KICK`. The seat is freed here and not when the socket's
   * close completes: a peer that never answers the close handshake would hold
   * it for the transport's close timeout otherwise. Runs once per send, so a
   * kick is never more than one send interval late.
   */
  private freeIdleSeats(now: number): void {
    for (const client of this.clients) {
      const session = this.sessions.get(client.sessionId);
      if (!session || now - session.lastInputAt < this.idleTimeoutMs) continue;
      this.idleSeatsFreed += 1;
      console.log(JSON.stringify({ event: 'world-room-idle-kick', slot: session.slot, idleSeconds: Math.round((now - session.lastInputAt) / 1000) }));
      this.freeSeat(client);
      client.leave(IDLE_KICK.code, IDLE_KICK.reason);
    }
  }

  /** The edge gate for `player/move`: budget, size, exact shape; then the command carries the session's slot, never the payload's. An accepted move is what keeps a seat. */
  private onMove(client: Client, payload: unknown): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const now = this.time.now();
    if (!session.budget.allows(now)) {
      this.dropped.overBudget += 1;
      return;
    }
    if (payloadLength(payload) > MAX_INBOUND_BYTES) {
      this.dropped.oversized += 1;
      return;
    }
    const move = readMoveMessage(payload);
    if (!move) {
      this.dropped.malformed += 1;
      return;
    }
    session.lastInputAt = now;
    this.pendingCommands.push({ type: 'player/move', slot: session.slot, x: move.x, y: move.y });
  }

  /** The next send carries a full state. Its own small budget: a full state is a hundred times a delta, and a flood of requests still costs one state per send. */
  private onResync(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const now = this.time.now();
    if (!session.budget.allows(now) || !session.resyncBudget.allows(now)) {
      this.dropped.overBudget += 1;
      return;
    }
    session.wantsFullState = true;
  }

  /**
   * Every type the room does not handle. Without this handler Colyseus
   * disconnects the sender; with it the message is dropped and counted. No
   * real client sends these, so a session that keeps sending them past its
   * budget is closed rather than decoded and dropped forever.
   */
  private onUnknownMessage(client: Client): void {
    this.dropped.unknownType += 1;
    const session = this.sessions.get(client.sessionId);
    if (session && !session.budget.allows(this.time.now())) client.leave(CloseCode.WITH_ERROR);
  }
}
