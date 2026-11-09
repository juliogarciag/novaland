import {
  applyWorldState,
  createReplica,
  findLevel,
  findPlayerEntity,
  TICK_RATE,
  type Command,
  type MoveMessage,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateUpdate,
} from '@novaland/sim';
import { readViewFrame, type ViewFrame } from '../render/viewFrame';
import type { Occupancy, PlayableWorld } from '../worlds/PlayableWorld';
import { WorldConnection, type ConnectionStatus, type JoinedRoom } from './connection';
import { ViewFrameBuffer } from './frameBuffer';
import { INTERPOLATION_BUFFER_TICKS, MAX_LEVEL_NAME_LENGTH, MAX_SLOT, RESYNC_RETRY_AFTER_UPDATES, WORLD_SEATS } from './tuning';

export interface OnlineWorldOptions {
  readonly endpoint: string;
  /** Every change of the connection's status, screens included. */
  readonly onStatus?: (status: ConnectionStatus) => void;
  /** How to join; tests pass a fake room. */
  readonly join?: (endpoint: string) => Promise<JoinedRoom>;
}

/**
 * Online play: the server owns the sim and this client holds a replica of
 * it. The welcome gives the seat, the level and a full state; deltas keep
 * the replica in step; `player/move` goes over the wire without a slot and
 * the server stamps the seat. Nothing here steps anything: the replica
 * throws on `step`, and the drawn frame comes from a buffer of the last
 * server states, two send intervals behind, interpolated to the display rate.
 *
 * The replica is created from the first welcome and kept for the life of the
 * page: a later welcome (after a drop) replaces its contents with the new
 * full state, which `applyWorldState` does whatever the tick. A later welcome
 * for a different level or capacity cannot be shown in the scene that was
 * built for the first one, so it is reported as incompatible: the connection
 * stops and the screen offers a reload (a hostile server must not be able
 * to make the page reload itself in a loop).
 */
export class OnlineWorld implements PlayableWorld {
  readonly sim: ReplicaHandle;
  readonly connection: WorldConnection;

  private slot: number;
  private refusedUpdates = 0;
  private readonly frames = new ViewFrameBuffer({ bufferTicks: INTERPOLATION_BUFFER_TICKS, ticksPerSecond: TICK_RATE });
  private lastMove: MoveMessage = { x: 0, y: 0 };
  /** Out-of-sequence updates seen since the last full state; a resync is asked for at 1 and again every `RESYNC_RETRY_AFTER_UPDATES`. */
  private outOfSequenceUpdates = 0;
  /** The welcome's own state was refused: ask for a full state as soon as the connection is online. */
  private needsFullState = false;

  private constructor(connection: WorldConnection, replica: ReplicaHandle, slot: number) {
    this.connection = connection;
    this.sim = replica;
    this.slot = slot;
  }

  /**
   * Starts joining. `connection` is there at once, so the screens can offer
   * a retry before anyone is seated; `seated` resolves the first time the
   * server seats this client, with the replica already holding the world.
   * Until then (and after a drop) `onStatus` tells what is going on; a full
   * world or an unreachable server keep `seated` pending while the
   * connection retries by itself, an incompatible server leaves it pending
   * for good.
   */
  static join(options: OnlineWorldOptions): { connection: WorldConnection; seated: Promise<OnlineWorld> } {
    let world: OnlineWorld | undefined;
    let resolveSeated: (world: OnlineWorld) => void = () => undefined;
    const seated = new Promise<OnlineWorld>((resolve) => {
      resolveSeated = resolve;
    });
    const connection = new WorldConnection({
      endpoint: options.endpoint,
      join: options.join,
      handlers: {
        onWelcome: (payload) => {
          const welcome = readWelcome(payload);
          if (!welcome) return { incompatible: 'the server sent a welcome this client does not understand' };
          if (world) return world.welcomeAgain(welcome);
          const level = findLevel(welcome.level);
          if (!level) return { incompatible: `this client has no level named "${welcome.level}"` };
          let replica: ReplicaHandle;
          try {
            replica = createReplica({ level, capacity: welcome.capacity });
          } catch {
            return { incompatible: `the server's capacity (${String(welcome.capacity)}) is out of this client's range` };
          }
          world = new OnlineWorld(connection, replica, welcome.slot);
          world.applyWelcomeState(welcome);
          resolveSeated(world);
          return 'seated';
        },
        onUpdate: (payload) => world?.applyUpdate(payload),
        onStatus: (status) => {
          world?.onStatus(status);
          options.onStatus?.(status);
        },
      },
  });
    connection.connect();
    return { connection, seated };
  }

  get localSlot(): number {
    return this.slot;
  }

  /** Updates the replica refused as malformed since the page loaded. Debug hooks read it. */
  get malformedUpdates(): number {
    return this.refusedUpdates;
  }

  /** Seats taken, counted from the replica: one entity per seat. */
  get occupancy(): Occupancy {
    let online = 0;
    for (let slot = 0; slot < WORLD_SEATS; slot += 1) {
      if (findPlayerEntity(this.sim, slot) !== undefined) online += 1;
    }
    return { online, seats: WORLD_SEATS };
  }

  nextFrame(commands: readonly Command[], deltaSeconds: number): ViewFrame {
    for (const command of commands) {
      // The only player-facing command there is today. The slot is dropped: the server stamps the seat.
      if (command.type === 'player/move') {
        this.lastMove = { x: command.x, y: command.y };
        this.connection.sendMove(this.lastMove);
      }
    }
    return this.frames.nextFrame(deltaSeconds) ?? readViewFrame(this.sim);
  }

  /** A welcome after a drop: the same world, a new seat, a fresh full state. */
  private welcomeAgain(welcome: WelcomeMessage): 'seated' | { readonly incompatible: string } {
    if (welcome.level !== this.sim.level.name || welcome.capacity !== this.sim.capacity) {
      return { incompatible: 'the server changed its world' };
    }
    this.slot = welcome.slot;
    this.applyWelcomeState(welcome);
    return 'seated';
  }

  private applyWelcomeState(welcome: WelcomeMessage): void {
    this.frames.reset();
    this.outOfSequenceUpdates = 0;
    // The connection is not online yet while the welcome is being read, so a refused state is asked for again once it is.
    this.needsFullState = applyWorldState(this.sim, welcome.state) !== 'applied';
    if (!this.needsFullState) this.frames.push(readViewFrame(this.sim));
  }

  /**
   * Writes a server update into the replica. The replica validates it. A
   * delta that does not chain is answered with one resync request, repeated
   * every `RESYNC_RETRY_AFTER_UPDATES` further misses in case the server
   * dropped the request, and the count starts over when a full state lands.
   */
  private applyUpdate(payload: unknown): void {
    const result = applyWorldState(this.sim, payload as WorldStateUpdate);
    if (result === 'applied') {
      if ((payload as WorldStateUpdate).kind === 'full') this.outOfSequenceUpdates = 0;
      this.frames.push(readViewFrame(this.sim));
      return;
    }
    if (result === 'malformed') {
      this.refusedUpdates += 1;
      return;
    }
    this.outOfSequenceUpdates += 1;
    if (this.outOfSequenceUpdates % RESYNC_RETRY_AFTER_UPDATES === 1) this.connection.sendResync();
  }

  /** Seated again: a welcome whose state was refused needs a full state, and the key the player still holds never reached the new seat. */
  private onStatus(status: ConnectionStatus): void {
    if (status.kind !== 'online') return;
    if (this.needsFullState) {
      this.needsFullState = false;
      this.connection.sendResync();
    }
    if (this.lastMove.x !== 0 || this.lastMove.y !== 0) this.connection.sendMove(this.lastMove);
  }
}

/**
 * The welcome behind an untrusted payload, or undefined when it has not the
 * shape the wire promises: a seat number in `0..MAX_SLOT`, a level name of
 * at most `MAX_LEVEL_NAME_LENGTH` characters, a capacity and a state object.
 * The capacity's range is checked by `createReplica`, the state by
 * `applyWorldState`.
 */
function readWelcome(payload: unknown): WelcomeMessage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { slot, level, capacity, state } = payload as Record<string, unknown>;
  if (!Number.isSafeInteger(slot) || (slot as number) < 0 || (slot as number) > MAX_SLOT) return undefined;
  if (typeof level !== 'string' || level.length > MAX_LEVEL_NAME_LENGTH || typeof capacity !== 'number') return undefined;
  if (typeof state !== 'object' || state === null) return undefined;
  return { slot: slot as number, level, capacity, state: state as WelcomeMessage['state'] };
}

export const __testing__ = { readWelcome };
