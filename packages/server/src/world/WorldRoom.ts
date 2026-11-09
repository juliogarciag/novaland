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
import { ErrorCode, Room, ServerError, type Client } from 'colyseus';
import { MessageBudget, payloadLength, readMoveMessage } from './inbound';
import { Seats } from './seats';
import { takeWholeTicks } from './takeWholeTicks';
import {
  DISCONNECT_MESSAGES_PER_SECOND,
  INBOUND_BURST,
  INBOUND_MESSAGES_PER_SECOND,
  LOOP_INTERVAL_MS,
  MAX_CATCH_UP_SECONDS,
  MAX_INBOUND_BYTES,
  MAX_SEATS,
  TICKS_PER_SEND,
  WORLD_ROOM_ID,
} from './tuning';

/** What the boot passes to `matchMaker.createRoom`. Clients cannot create rooms (see startWorldServer). */
export interface WorldRoomOptions {
  /** Seed of the one sim. The boot draws a random one; a test pins it. */
  readonly seed: number;
}

/** What the room knows about one connected session. */
interface Session {
  readonly slot: number;
  /** The last world state sent to this session, so the next delta chains from it. Unset until the welcome. */
  lastSent: WorldState | undefined;
  /** Set by `world/resync`: the next send carries a full state instead of a delta. Many requests collapse into one state. */
  wantsFullState: boolean;
  readonly budget: MessageBudget;
}

/** Messages the room dropped at the edge, by reason. Read by tests and smoke runs; never logged per message. */
export interface DroppedMessages {
  unknownType: number;
  oversized: number;
  malformed: number;
  overBudget: number;
}

/**
 * The world: one authoritative sim, five seats, created once at boot and
 * joined by id (ADR 0004). The room is the only thing that steps the sim,
 * one whole tick of `FIXED_DT` at a time as real time earns them. Sessions
 * get a seat (`slot`) on join and lose it on leave; the sim sees that as
 * `player/join` and `player/leave`. Inbound messages pass the edge gate in
 * `inbound.ts` (allow-list, budget, size, exact shape) and leave it stamped
 * with the session's slot; the sim's own handlers validate again. Outbound,
 * each session gets a full state in its welcome and then a delta every
 * `TICKS_PER_SEND` ticks, diffed from the last state sent to it.
 */
export class WorldRoom extends Room {
  override maxClients = MAX_SEATS;
  /** The world outlives its players: an empty room stays up. */
  override autoDispose = false;
  override maxMessagesPerSecond = DISCONNECT_MESSAGES_PER_SECOND;

  readonly dropped: DroppedMessages = { unknownType: 0, oversized: 0, malformed: 0, overBudget: 0 };

  private sim!: SimHandle;
  private readonly seats = new Seats(MAX_SEATS);
  private readonly sessions = new Map<string, Session>();
  private pendingCommands: Command[] = [];
  private tickWaiters: Array<() => void> = [];
  private leftover = 0;
  private wokeAt = 0;
  private lastSendTick = 0;
  private loop: NodeJS.Timeout | undefined;

  /** The sim's tick, for smoke runs and tests. */
  get tick(): number {
    return this.sim.tick;
  }

  get seatsTaken(): number {
    return this.seats.taken;
  }

  override async onCreate(options: WorldRoomOptions): Promise<void> {
    this.roomId = WORLD_ROOM_ID;
    this.sim = await createSim({ seed: options.seed });
    this.onMessage(WIRE.move, (client, payload: unknown) => this.onMove(client, payload));
    this.onMessage(WIRE.resync, (client) => this.onResync(client));
    // Every other type is dropped here. Without this handler Colyseus disconnects the sender.
    this.onMessage('*', () => {
      this.dropped.unknownType += 1;
    });
    this.wokeAt = performance.now();
    this.loop = setInterval(() => this.advance(), LOOP_INTERVAL_MS);
  }

  /**
   * Seats the session and welcomes it with the state after the tick that
   * spawned its player, so the client finds its own entity in it. The
   * matchmaker refuses a sixth join before this runs (`maxClients`); the
   * refusal here is the guard behind it.
   */
  override async onJoin(client: Client): Promise<void> {
    const slot = this.seats.claim(client.sessionId);
    if (slot === undefined) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, JOIN_REFUSAL.worldFull);
    const session: Session = {
      slot,
      lastSent: undefined,
      wantsFullState: false,
      budget: new MessageBudget(INBOUND_MESSAGES_PER_SECOND, INBOUND_BURST, performance.now()),
    };
    this.sessions.set(client.sessionId, session);
    this.pendingCommands.push({ type: 'player/join', slot });
    await this.afterNextTick();
    const state = worldState(this.sim);
    session.lastSent = state;
    const welcome: WelcomeMessage = { slot, level: this.sim.level.name, capacity: this.sim.capacity, state };
    client.send(WIRE.welcome, welcome);
  }

  /** Frees the seat; the sim removes the player on the next tick. Runs for consented and dropped connections alike. */
  override onLeave(client: Client): void {
    const slot = this.seats.release(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (slot !== undefined) this.pendingCommands.push({ type: 'player/leave', slot });
  }

  override onDispose(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = undefined;
    this.sim.destroy();
  }

  /** Runs the ticks real time has earned since the last wake-up, then a send if one is due. */
  private advance(): void {
    const now = performance.now();
    const { ticks, leftover } = takeWholeTicks({
      leftover: this.leftover,
      deltaSeconds: (now - this.wokeAt) / 1000,
      dt: FIXED_DT,
      maxFrameSeconds: MAX_CATCH_UP_SECONDS,
    });
    this.wokeAt = now;
    this.leftover = leftover;
    for (let tick = 0; tick < ticks; tick += 1) {
      const commands = this.pendingCommands;
      this.pendingCommands = [];
      this.sim.step(commands);
      const waiters = this.tickWaiters;
      this.tickWaiters = [];
      for (const resolve of waiters) resolve();
    }
    if (this.sim.tick - this.lastSendTick >= TICKS_PER_SEND) {
      this.lastSendTick = this.sim.tick;
      this.sendWorldUpdates();
    }
  }

  /** Resolves after the next tick, so a command queued before the call has been applied. */
  private afterNextTick(): Promise<void> {
    return new Promise((resolve) => this.tickWaiters.push(resolve));
  }

  /**
   * One update to every welcomed session: a full state to those that asked
   * for one, a delta from the last state sent to each of the others. Sessions
   * that last saw the same tick share one diff.
   */
  private sendWorldUpdates(): void {
    const next = worldState(this.sim);
    const deltaByFromTick = new Map<number, WorldStateDelta>();
    for (const client of this.clients) {
      const session = this.sessions.get(client.sessionId);
      if (!session?.lastSent) continue;
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

  /** The edge gate for `player/move`: budget, size, exact shape; then the command carries the session's slot, never the payload's. */
  private onMove(client: Client, payload: unknown): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    if (!session.budget.allows(performance.now())) {
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
    this.pendingCommands.push({ type: 'player/move', slot: session.slot, x: move.x, y: move.y });
  }

  /** The next send carries a full state. Budgeted like any message; a flood of requests still costs one state per send. */
  private onResync(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    if (!session.budget.allows(performance.now())) {
      this.dropped.overBudget += 1;
      return;
    }
    session.wantsFullState = true;
  }
}
