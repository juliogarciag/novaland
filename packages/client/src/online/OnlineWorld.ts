import {
  applyWorldState,
  createPrediction,
  createReplica,
  findLevel,
  findPlayerEntity,
  TICK_RATE,
  WIRE_PROTOCOL,
  type Command,
  type PredictionHandle,
  type PredictionOptions,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateUpdate,
} from '@novaland/sim';
import { readViewFrame, type ViewFrame } from '../render/viewFrame';
import type { Occupancy, PlayableWorld } from '../worlds/PlayableWorld';
import { PROTOCOL_MISMATCH_REASON, WorldConnection, type ConnectionStatus, type JoinedRoom } from './connection';
import { ViewFrameBuffer } from './frameBuffer';
import { LocalPlayerPrediction, type PredictionReport } from './prediction';
import { INTERPOLATION_BUFFER_TICKS, MAX_LEVEL_NAME_LENGTH, MAX_SLOT, RESYNC_RETRY_AFTER_UPDATES, WORLD_SEATS } from './tuning';

export interface OnlineWorldOptions {
  readonly endpoint: string;
  /** Every change of the connection's status, screens included. */
  readonly onStatus?: (status: ConnectionStatus) => void;
  /** How to join; tests pass a fake room. */
  readonly join?: (endpoint: string) => Promise<JoinedRoom>;
  /** False draws the local player from server states like everyone else (ADR 0011's comparison switch). Default true. */
  readonly predictsLocalPlayer?: boolean;
  /** How the prediction sim is made; it loads the physics engine. Default: the sim's `createPrediction`. */
  readonly createPrediction?: (options: PredictionOptions) => Promise<PredictionHandle>;
  /** Milliseconds from a fixed point, for the prediction's clock. Default `performance.now`: the game loop's delta is smoothed and loses time in a hitch. */
  readonly now?: () => number;
}

/** The player's move intent as the keyboard gives it. */
interface Direction {
  readonly x: number;
  readonly y: number;
}

/**
 * Online play: the server owns the sim and this client holds a replica of
 * it. The welcome gives the seat, the level and a full state; deltas keep
 * the replica in step; `player/move` goes over the wire without a slot and
 * the server stamps the seat. The replica is never stepped (it throws), and
 * the drawn frame comes from a buffer of the last server states, two send
 * intervals behind, interpolated to the display rate.
 *
 * The local player alone is drawn ahead of that (ADR 0011): its moves are
 * applied at once to a prediction sim this world steps, every server state
 * is reconciled with it, and the frame shows the predicted player among the
 * interpolated others. The prediction is a guess that the next server state
 * replaces; when there is none (the physics engine is still loading, the
 * player could not be adopted, it failed) the player is drawn from the
 * buffer like everyone else.
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
  private lastMove: Direction = { x: 0, y: 0 };
  /** The sequence the next move goes out with; the server acknowledges moves by it. Counts on across seats. */
  private nextMoveSequence = 1;
  /** Undefined until the prediction sim has loaded, and for good once it failed. */
  private prediction: LocalPlayerPrediction | undefined;
  private readonly now: () => number;
  /** When the prediction's clock started, on `now`'s scale. */
  private predictionStartedAt = 0;
  /** Where the last frame drew the local player, in metres; undefined when it drew none. */
  private drawnLocalPlayer: Direction | undefined;
  /** Out-of-sequence updates seen since the last full state; a resync is asked for at 1 and again every `RESYNC_RETRY_AFTER_UPDATES`. */
  private outOfSequenceUpdates = 0;
  /** The welcome's own state was refused: ask for a full state as soon as the connection is online. */
  private needsFullState = false;

  private constructor(connection: WorldConnection, replica: ReplicaHandle, slot: number, options: OnlineWorldOptions) {
    this.connection = connection;
    this.sim = replica;
    this.slot = slot;
    this.now = options.now ?? (() => performance.now());
    if (options.predictsLocalPlayer !== false) void this.startPredicting(options.createPrediction ?? createPrediction);
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
          if (speaksAnotherProtocol(payload)) return { incompatible: PROTOCOL_MISMATCH_REASON };
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
          world = new OnlineWorld(connection, replica, welcome.slot, options);
          world.applyWelcomeState(welcome);
          resolveSeated(world);
          return 'seated';
        },
        onUpdate: (payload) => world?.applyUpdate(payload),
        onMoveApplied: (payload) => world?.predict((prediction) => prediction.moveApplied(payload)),
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

  /** The connection's measured round trip to the server; undefined until measured and while not seated. */
  get latencyMs(): number | undefined {
    return this.connection.latencyMs;
  }

  /** What the prediction is doing, for the debug hooks; undefined while there is none. */
  get predictionReport(): PredictionReport | undefined {
    return this.prediction?.report;
  }

  /** Where the last frame drew the local player, in metres: predicted when predicting, else from server states. Undefined when it drew none. */
  get localPlayerDrawnAt(): { readonly x: number; readonly y: number } | undefined {
    return this.drawnLocalPlayer;
  }

  nextFrame(commands: readonly Command[], deltaSeconds: number): ViewFrame {
    for (const command of commands) this.queueCommand(command);
    this.predict((prediction) => prediction.advanceTo(this.predictionClientTime(), this.sim));
    const fromServer = this.frames.nextFrame(deltaSeconds) ?? readViewFrame(this.sim);
    const frame = this.predict((prediction) => prediction.withLocalPlayer(fromServer)) ?? fromServer;
    const eid = findPlayerEntity(this.sim, this.slot);
    const drawn = eid === undefined ? undefined : frame.renderables.find((renderable) => renderable.eid === eid);
    this.drawnLocalPlayer = drawn ? { x: drawn.x, y: drawn.y } : undefined;
    return frame;
  }

  /** Sends the command now; there is no tick to wait for here. Everything but `player/move` stays home: the server seats players itself. */
  queueCommand(command: Command): void {
    // The only player-facing command there is today. The slot is dropped: the server stamps the seat.
    if (command.type !== 'player/move') return;
    this.lastMove = { x: command.x, y: command.y };
    this.sendMove(this.lastMove);
  }

  /** Sends a move under the next sequence and, once it is on its way, applies it to the prediction too. Nothing happens unless seated. */
  private sendMove(move: Direction): void {
    const sequence = this.nextMoveSequence;
    if (!this.connection.sendMove({ x: move.x, y: move.y, sequence })) return;
    this.nextMoveSequence += 1;
    this.predict((prediction) => prediction.recordMove(move, sequence));
  }

  /**
   * Loads the prediction sim (the physics engine comes with it) and starts
   * predicting from what the replica holds by then. Until it resolves, and
   * for good if it fails, the local player is drawn from server states.
   */
  private async startPredicting(create: (options: PredictionOptions) => Promise<PredictionHandle>): Promise<void> {
    try {
      const prediction = new LocalPlayerPrediction(await create({ level: this.sim.level, capacity: this.sim.capacity }));
      this.predictionStartedAt = this.now();
      this.prediction = prediction;
      if (this.connection.status.kind === 'online') this.predict((ready) => ready.follow(this.sim, this.slot));
    } catch (error) {
      console.warn('Novaland: no prediction, the local player follows the server', error);
    }
  }

  /** The prediction's clock: real time since it started, in sim ticks, fraction included. */
  private predictionClientTime(): number {
    return ((this.now() - this.predictionStartedAt) / 1000) * TICK_RATE;
  }

  /**
   * Runs `use` on the prediction and returns what it returned; undefined
   * when there is no prediction. A prediction that throws is dropped for
   * good and the local player is drawn from server states from then on:
   * what it holds came from the network, and it must never take the page
   * down with it.
   */
  private predict<Result>(use: (prediction: LocalPlayerPrediction) => Result): Result | undefined {
    const prediction = this.prediction;
    if (!prediction) return undefined;
    try {
      return use(prediction);
    } catch (error) {
      this.prediction = undefined;
      console.warn('Novaland: prediction stopped, the local player follows the server', error);
      return undefined;
    }
  }

  /**
   * The page lost focus or was hidden while a key may be down: the player
   * stops. The keyboard lets go of its keys then, but the stop it would send
   * comes from the game loop, which a hidden tab pauses; without this the
   * server would see the avatar walking for as long as the tab stays hidden,
   * and an abandoned tab would never be freed as idle (#22). Forgetting the
   * held move also keeps a reconnect from walking again on its own.
   */
  stopWalking(): void {
    if (this.lastMove.x === 0 && this.lastMove.y === 0) return;
    this.lastMove = { x: 0, y: 0 };
    this.sendMove(this.lastMove);
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
    this.predict((prediction) => prediction.follow(this.sim, this.slot));
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
      this.predict((prediction) => prediction.reconcile(this.sim));
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
    if (status.kind !== 'online') {
      this.predict((prediction) => prediction.stop());
      return;
    }
    if (this.needsFullState) {
      this.needsFullState = false;
      this.connection.sendResync();
    }
    if (this.lastMove.x !== 0 || this.lastMove.y !== 0) this.sendMove(this.lastMove);
  }
}

/**
 * The welcome behind an untrusted payload, or undefined when it has not the
 * shape the wire promises: this client's `WIRE_PROTOCOL`, a seat number in `0..MAX_SLOT`, a level name of
 * at most `MAX_LEVEL_NAME_LENGTH` characters, a capacity and a state object.
 * The capacity's range is checked by `createReplica`, the state by
 * `applyWorldState`.
 */
function readWelcome(payload: unknown): WelcomeMessage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { protocol, slot, level, capacity, state } = payload as Record<string, unknown>;
  if (protocol !== WIRE_PROTOCOL) return undefined;
  if (!Number.isSafeInteger(slot) || (slot as number) < 0 || (slot as number) > MAX_SLOT) return undefined;
  if (typeof level !== 'string' || level.length > MAX_LEVEL_NAME_LENGTH || typeof capacity !== 'number') return undefined;
  if (typeof state !== 'object' || state === null) return undefined;
  return { protocol, slot: slot as number, level, capacity, state: state as WelcomeMessage['state'] };
}

/** True when a welcome names a wire protocol other than this client's, or none (a server from before the protocol had a version). */
function speaksAnotherProtocol(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && (payload as { protocol?: unknown }).protocol !== WIRE_PROTOCOL;
}

export const __testing__ = { readWelcome };
