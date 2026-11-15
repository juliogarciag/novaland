import {
  createSim,
  diffWorldState,
  FIXED_DT,
  getPlayerPosition,
  JOIN_REFUSAL,
  readMapTiles,
  WIRE,
  WIRE_PROTOCOL,
  worldState,
  type Command,
  type MoveAppliedMessage,
  type SimHandle,
  type WelcomeMessage,
  type WorldState,
  type WorldStateDelta,
} from '@novaland/sim';
import { ClientState, CloseCode, ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { MessageBudget, payloadLength, readMoveMessage, readPlayerKey, speaksProtocol } from './inbound';
import { IDLE_KICK, REPLACED_KICK } from './kicks';
import { RoomSeats } from './roomSeats';
import { openSavedPositions, type SavedPosition, type SavedPositions } from './savedPositions';
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
  NEW_PLAYER_SAVE_AFTER_MS,
  POSITION_SAVE_INTERVAL_MS,
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
  /** Milliseconds a session may stand still without an accepted input before its seat is freed; `IDLE_TIMEOUT_MS` unless set. */
  readonly idleTimeoutMs?: number;
  /** The clock the room reads; `performance.now` unless a test passes a fake. */
  readonly clock?: Clock;
  /** Where returning players are put back (#55). The boot opens the one on disk and closes it; without one the room keeps positions in memory, which lasts as long as the room. */
  readonly savedPositions?: SavedPositions;
}

/** What the room knows about one connected session. */
interface Session {
  readonly client: Client;
  readonly slot: number;
  /** Which player this is, from the token of the join (`readPlayerKey`); undefined for a join without one, whose position is never saved. Never sent to anyone and never logged. */
  readonly playerKey: string | undefined;
  /** When this player took a seat. A player who joins again while still seated keeps the time of the first seat. */
  readonly seatedAt: number;
  /** The store holds a position for this player: it did at the join, or the room has saved one since. */
  remembered: boolean;
  /** The last position saved for this session, so a player who stands still is not written again. */
  savedPosition: SavedPosition | undefined;
  /** A newer join of the same player took this session's seat; the session is closed and, if its own join is still waiting for a tick, that join fails. */
  replaced: boolean;
  /** The last world state sent to this session, so the next delta chains from it. Unset until the welcome. */
  lastSent: WorldState | undefined;
  /** When the welcome went out; a session that has not acknowledged the join `JOIN_ACK_TIMEOUT_MS` later is closed. */
  welcomedAt: number | undefined;
  /** Set by `world/resync`: the next send carries a full state instead of a delta. */
  wantsFullState: boolean;
  /** When the session's last input passed the edge gate (its join counts as one); `idleTimeoutMs` after it the seat is freed, unless the session is walking. */
  lastInputAt: number;
  /** The last accepted move had a direction: the player is holding a key and the avatar is walking. A client sends a move only when the direction changes, so a held key sends nothing more; the idle clock runs only once the player stops. The browser client also sends a stop when its tab is hidden or loses focus, so an abandoned tab does not stay walking. */
  walking: boolean;
  /** Sequence of the last accepted move still waiting in `pendingCommands` for the next tick; undefined once that tick ran. */
  queuedMoveSequence: number | undefined;
  /** The last move of this session the sim applied and the tick that step made, not yet told to the client; it goes out just before the next world update (ADR 0012). */
  moveToAcknowledge: MoveAppliedMessage | undefined;
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
 * session that stands still and sends no accepted input for `idleTimeoutMs`
 * is closed with `IDLE_KICK` so its seat goes to someone who plays (#22); a
 * session whose last move has a direction is walking, never idle. Each move
 * carries the client's sequence; once a tick has applied it the session is
 * told which one and in which tick, just before the world update that first
 * includes it, so a client that predicts its own movement knows what to
 * replay (ADR 0012).
 *
 * A join may carry a player token. The gate turns it into a key, and the
 * room saves where that player stands when they leave and every
 * `POSITION_SAVE_INTERVAL_MS` in between; a later join with the same token
 * is put back there by a `returnTo` on the `player/join` the room issues
 * (ADR 0014). One token is one player: a join whose token already holds a
 * seat takes that player over where they stand, and the session that held
 * it is closed with `REPLACED_KICK`.
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
  private savedPositions: SavedPositions | undefined;
  /** True when the room opened `savedPositions` itself (no boot passed one), so the room closes it. */
  private ownsSavedPositions = false;
  private positionsSavedAt = 0;
  private readonly seats = new RoomSeats(MAX_SEATS);
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
      // A typo must never silently become ten minutes, or zero. The boot is stricter still: IDLE_TIMEOUT_SECONDS is at least 1.
      if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) throw new RangeError(`idleTimeoutMs must be a positive number of milliseconds, got ${String(options.idleTimeoutMs)}`);
      this.idleTimeoutMs = options.idleTimeoutMs;
    }
    this.savedPositions = options.savedPositions ?? openSavedPositions();
    this.ownsSavedPositions = options.savedPositions === undefined;
    this.sim = await createSim({ seed: options.seed });
    this.onMessage(WIRE.move, (client, payload: unknown) => this.onMove(client, payload));
    this.onMessage(WIRE.resync, (client) => this.onResync(client));
    this.onMessage('*', (client) => this.onUnknownMessage(client));
    this.wokeAt = this.time.now();
    this.positionsSavedAt = this.wokeAt;
    this.loop = setInterval(() => this.advance(), LOOP_INTERVAL_MS);
  }

  /**
   * Seats the session and welcomes it with the state after the tick that
   * spawned its player, so the client finds its own entity in it. The
   * matchmaker refuses a sixth join before this runs (`maxClients`, ADR
   * 0005); the refusal here is the guard behind it. A client built against
   * another wire protocol, or one from before the protocol had a version, is
   * refused before it takes a seat: seated, it would send moves this room
   * drops and never learn why.
   *
   * The only other thing read from the options is the player token, and only
   * as a key (`readPlayerKey`). A key the store knows puts the player back
   * where they left; a key that holds a seat right now takes that player over
   * where they stand. Where the player appears is always the room's own
   * record, never a field of the join.
   */
  override async onJoin(client: Client, options?: unknown): Promise<void> {
    if (!speaksProtocol(options, WIRE_PROTOCOL)) throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, JOIN_REFUSAL.protocolMismatch);
    const playerKey = readPlayerKey(options);
    const replaced = playerKey === undefined ? undefined : this.replaceSessionOf(playerKey);
    const slot = this.seats.claim(client.sessionId);
    if (slot === undefined) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, JOIN_REFUSAL.worldFull);
    const now = this.time.now();
    const savedPosition = playerKey === undefined ? undefined : this.savedPositions?.find(playerKey);
    const returnTo = replaced?.position ?? savedPosition;
    const session: Session = {
      client,
      slot,
      playerKey,
      seatedAt: replaced?.seatedAt ?? now,
      remembered: savedPosition !== undefined,
      // What the store holds for this player right now, so a join that changes nothing writes nothing.
      savedPosition,
      replaced: false,
      lastSent: undefined,
      welcomedAt: undefined,
      wantsFullState: false,
      lastInputAt: now,
      walking: false,
      queuedMoveSequence: undefined,
      moveToAcknowledge: undefined,
      budget: new MessageBudget(INBOUND_MESSAGES_PER_SECOND, INBOUND_BURST, now),
      resyncBudget: new MessageBudget(RESYNCS_PER_SECOND, RESYNC_BURST, now),
    };
    this.sessions.set(client.sessionId, session);
    this.pendingCommands.push(returnTo ? { type: 'player/join', slot, returnTo } : { type: 'player/join', slot });
    const ticked = await this.afterNextTick();
    if (!ticked || !this.sim) throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, 'the world is shutting down');
    // The same player joined again while this join waited for its tick: that join plays, this one ends here.
    if (session.replaced) throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, REPLACED_KICK.reason);
    const state = worldState(this.sim);
    session.lastSent = state;
    session.welcomedAt = this.time.now();
    const welcome: WelcomeMessage = { protocol: WIRE_PROTOCOL, slot, map: readMapTiles(this.sim.map).checksum, capacity: this.sim.capacity, state };
    client.send(WIRE.welcome, welcome);
  }

  /** Frees the seat; the sim removes the player on the next tick. Runs for consented and dropped connections alike, and after a kick, which freed the seat already. */
  override onLeave(client: Client): void {
    this.freeSeat(client);
  }

  /** The session's seat, free, and `player/leave` queued for its slot; nothing when the session holds no seat any more. Where the player stood is saved first: the entity is still in the sim until that leave runs. */
  private freeSeat(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (session) this.savePosition(session, this.time.now());
    const slot = this.seats.release(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (slot !== undefined) this.pendingCommands.push({ type: 'player/leave', slot });
  }

  /**
   * One token is one player. If the player `playerKey` holds a seat, that
   * seat is freed and its session closed with `REPLACED_KICK`, and what the
   * join that takes over needs is returned: where the player stands right now
   * (undefined when their own join has not run yet), when they first sat down
   * and the last position saved for them. Undefined when the player holds no seat.
   * The newest join wins because the older session may be a connection the
   * player already lost and the server has not yet seen drop; refusing the
   * new one would lock the player out of their own character.
   */
  private replaceSessionOf(playerKey: string): { readonly position: SavedPosition | undefined; readonly seatedAt: number; readonly savedPosition: SavedPosition | undefined } | undefined {
    for (const session of this.sessions.values()) {
      if (session.playerKey !== playerKey) continue;
      const position = this.positionOf(session);
      session.replaced = true;
      this.freeSeat(session.client);
      session.client.leave(REPLACED_KICK.code, REPLACED_KICK.reason);
      return { position, seatedAt: session.seatedAt, savedPosition: session.savedPosition };
    }
    return undefined;
  }

  /**
   * Saves where the session's player stands, if the session has a player key
   * and the player has earned a place in the store: the store knows them
   * already, or they have held a seat for `NEW_PLAYER_SAVE_AFTER_MS`. That
   * wait is what keeps a flood of made-up tokens from pushing real players
   * out of a store that holds `MAX_SAVED_PLAYERS`.
   */
  private savePosition(session: Session, now: number): void {
    if (session.playerKey === undefined || !this.savedPositions) return;
    if (!session.remembered && now - session.seatedAt < NEW_PLAYER_SAVE_AFTER_MS) return;
    const position = this.positionOf(session);
    // A player who has not moved since their last save is not written again: a join, a leave or a takeover that changes nothing costs the disk nothing.
    if (!position || (position.x === session.savedPosition?.x && position.y === session.savedPosition.y)) return;
    if (!this.savedPositions.save(session.playerKey, position)) return;
    session.remembered = true;
    session.savedPosition = position;
  }

  /** Saves every seated player who moved since their last save. Runs every `POSITION_SAVE_INTERVAL_MS`, so a crash loses that much walking at most. */
  private saveMovedPlayers(now: number): void {
    for (const session of this.sessions.values()) this.savePosition(session, now);
  }

  /**
   * Where the session's player stands, or undefined until the session has
   * been welcomed. Before the tick that spawns its player, the session's slot
   * can still hold the player who had the seat before (their `player/leave`
   * waits for the same tick), and that position is not this player's.
   */
  private positionOf(session: Session): SavedPosition | undefined {
    return this.sim && session.lastSent ? getPlayerPosition(this.sim, session.slot) : undefined;
  }

  /** Stops the loop, wakes any join still waiting for a tick (it fails: no tick is coming), saves where everyone still seated stands and frees the sim. */
  override onDispose(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
    this.settleTickWaiters(false);
    const now = this.time.now();
    for (const session of this.sessions.values()) this.savePosition(session, now);
    this.sessions.clear();
    if (this.ownsSavedPositions) this.savedPositions?.close();
    this.savedPositions = undefined;
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
        if (commands.length > 0) this.queueMoveAcknowledgements(sim.tick);
        this.settleTickWaiters(true);
      }
      if (sim.tick - this.lastSendTick >= TICKS_PER_SEND) {
        this.lastSendTick = sim.tick;
        this.sendWorldUpdates(sim, now);
        this.freeIdleSeats(now);
      }
      if (now - this.positionsSavedAt >= POSITION_SAVE_INTERVAL_MS) {
        this.positionsSavedAt = now;
        this.saveMovedPlayers(now);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'world-room-crashed', seed: sim.seed, tick: sim.tick, error: String(error) }));
      throw error;
    }
  }

  /** The tick that made the sim's tick `tick` applied every command that was waiting: each session's queued move becomes the one to acknowledge. */
  private queueMoveAcknowledgements(tick: number): void {
    for (const session of this.sessions.values()) {
      if (session.queuedMoveSequence === undefined) continue;
      session.moveToAcknowledge = { sequence: session.queuedMoveSequence, tick };
      session.queuedMoveSequence = undefined;
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
   * unacknowledged past `JOIN_ACK_TIMEOUT_MS` is closed. A session whose
   * move was applied since its last update is told so first, so the update
   * that follows is the first state that includes that move.
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
      if (session.moveToAcknowledge) {
        client.send(WIRE.moveApplied, session.moveToAcknowledge);
        session.moveToAcknowledge = undefined;
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
   * Frees the seat of every session that stands still (its last accepted move
   * has no direction, or it never moved) and whose last accepted input is
   * `idleTimeoutMs` or more behind `now`, then closes it; the close reaches
   * the client as `IDLE_KICK`. The seat is freed here and not when the socket's
   * close completes: a peer that never answers the close handshake would hold
   * it for the transport's close timeout otherwise. Runs once per send, so a
   * kick is never more than one send interval late.
   */
  private freeIdleSeats(now: number): void {
    for (const client of this.clients) {
      const session = this.sessions.get(client.sessionId);
      if (!session || session.walking || now - session.lastInputAt < this.idleTimeoutMs) continue;
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
    session.walking = move.x !== 0 || move.y !== 0;
    session.queuedMoveSequence = move.sequence;
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
