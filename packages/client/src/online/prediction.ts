import {
  adoptEntity,
  findPlayerEntity,
  getHeading,
  getRenderables,
  releaseAdoptedEntities,
  type Heading,
  type MoveAppliedMessage,
  type MoveCommand,
  type PredictionHandle,
  type SimHandle,
} from '@novaland/sim';
import type { ViewFrame } from '../render/viewFrame';
import { CORRECTION_HALF_LIFE_SECONDS, MAX_LIVE_PREDICTION_TICKS, MAX_PREDICTION_TICKS, NEGLIGIBLE_CORRECTION_METRES, SNAP_DISTANCE_METRES } from './tuning';

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A move the player made that the server has not acknowledged yet. */
interface RecordedMove {
  readonly sequence: number;
  /** The client tick the move was applied in: the step from this tick to the next. */
  readonly clientTick: number;
  readonly command: MoveCommand;
}

/** What the debug hooks and the end-to-end checks read about the prediction. */
export interface PredictionReport {
  /** True while the local player is drawn from the prediction; false while it is drawn from server states like everyone else. */
  readonly predicting: boolean;
  /** Moves sent that the server has not acknowledged. */
  readonly unacknowledgedMoves: number;
  /** Ticks replayed on top of the last server state: how far ahead of it the prediction runs. */
  readonly ticksAhead: number;
  /** Server states reconciled since the seat was taken. */
  readonly reconciliations: number;
  /** Length in metres of the correction still being smoothed away; 0 when the drawn position is the predicted one. */
  readonly correctionMetres: number;
  /** The longest correction a reconciliation made since the seat was taken, in metres. */
  readonly largestCorrectionMetres: number;
}

const ZERO: Point = { x: 0, y: 0 };

/**
 * The local player, ahead of the server (ADR 0011). It owns a prediction sim
 * that holds the level's terrain and one adopted entity: the local player as
 * the replica last had it. Moves are applied to it the tick they are made;
 * every server state throws the guess away, adopts the player again and
 * replays the moves the server has not applied yet, which lands on the same
 * spot when the server agreed. What it changes when the server did not agree
 * is not drawn as a jump: the difference fades out over a few frames.
 *
 * Time comes in as client ticks, a clock of its own that counts real time in
 * sim ticks. It decides nothing about the game: the sim's own rules move the
 * player, and what the server says replaces whatever was guessed.
 */
export class LocalPlayerPrediction {
  private slot = -1;
  private eid: number | undefined;
  /** Client ticks stepped so far: moves made now are applied in the step from this tick to the next. */
  private clientTick = 0;
  /** How far into the current tick the last frame was, in [0, 1): the drawn position is that far between the last two predicted ones. */
  private tickFraction = 0;
  private lastClientTime = 0;
  private moves: RecordedMove[] = [];
  /** Unacknowledged moves from before the tick the last server state stands for, to apply with the next step. */
  private lateCommands: MoveCommand[] = [];
  /** Server tick minus client tick, measured at the last acknowledged move; undefined until one was acknowledged. */
  private serverTicksAhead: number | undefined;
  private beforeLastStep: Point = ZERO;
  private predicted: Point = ZERO;
  private correction: Point = ZERO;
  private ticksAhead = 0;
  private reconciliations = 0;
  private largestCorrectionMetres = 0;

  constructor(private readonly sim: PredictionHandle) {}

  get report(): PredictionReport {
    return {
      predicting: this.eid !== undefined,
      unacknowledgedMoves: this.moves.length,
      ticksAhead: this.ticksAhead,
      reconciliations: this.reconciliations,
      correctionMetres: Math.hypot(this.correction.x, this.correction.y),
      largestCorrectionMetres: this.largestCorrectionMetres,
    };
  }

  /** A seat was taken: forget everything about the last one and start from the player `replica` holds in `slot`. */
  follow(replica: SimHandle, slot: number): void {
    this.stop();
    this.slot = slot;
    this.moves = [];
    this.serverTicksAhead = undefined;
    this.reconciliations = 0;
    this.largestCorrectionMetres = 0;
    this.reconcile(replica);
  }

  /** Stops predicting until the next server state: the local player is drawn from server states meanwhile. */
  stop(): void {
    releaseAdoptedEntities(this.sim);
    this.eid = undefined;
    this.lateCommands = [];
    this.correction = ZERO;
    this.ticksAhead = 0;
  }

  /** The player made a move, sent to the server as `sequence`: it is applied in the next step. */
  recordMove(move: Point, sequence: number): void {
    this.moves.push({ sequence, clientTick: this.clientTick, command: { type: 'player/move', slot: this.slot, x: move.x, y: move.y } });
  }

  /**
   * The server applied move `sequence` in the step that made its tick `tick`:
   * that move and the ones before it are in every state from now on, and the
   * tick ties the server's timeline to this one. Whatever the payload holds
   * that is not such a message is ignored.
   */
  moveApplied(message: unknown): void {
    const applied = readMoveApplied(message);
    if (!applied) return;
    const move = this.moves.find((candidate) => candidate.sequence === applied.sequence);
    if (move) this.serverTicksAhead = applied.tick - 1 - move.clientTick;
    this.moves = this.moves.filter((candidate) => candidate.sequence > applied.sequence);
  }

  /**
   * Real time moved on to `clientTime`, in client ticks with a fraction:
   * steps the ticks that became whole, each with the moves made in it. After
   * a gap too long to step (a hidden tab) the prediction is rebuilt from
   * `replica` instead.
   */
  advanceTo(clientTime: number, replica: SimHandle): void {
    const wholeTicks = Math.floor(clientTime);
    const elapsedSeconds = Math.max(0, clientTime - this.lastClientTime) * this.sim.dt;
    this.lastClientTime = clientTime;
    this.tickFraction = clientTime - wholeTicks;
    this.correction = fade(this.correction, elapsedSeconds);
    if (this.eid === undefined) {
      this.clientTick = Math.max(this.clientTick, wholeTicks);
      return;
    }
    if (wholeTicks - this.clientTick > MAX_LIVE_PREDICTION_TICKS) {
      this.clientTick = wholeTicks;
      this.reconcile(replica);
      this.correction = ZERO;
      return;
    }
    while (this.clientTick < wholeTicks) {
      const commands = [...this.lateCommands, ...this.movesMadeIn(this.clientTick)];
      this.lateCommands = [];
      this.beforeLastStep = this.predicted;
      this.sim.step(commands);
      this.clientTick += 1;
      this.predicted = this.positionOf(this.eid);
    }
  }

  /**
   * The replica holds a new server state: adopts the local player from it
   * and replays what the server has not applied yet. The difference to what
   * was drawn before becomes the correction that fades out. When the player
   * cannot be adopted (it is gone, or the state gives it no body) prediction
   * stops until a state where it can.
   */
  reconcile(replica: SimHandle): void {
    const eid = findPlayerEntity(replica, this.slot);
    const drawnBefore = this.eid !== undefined && this.eid === eid ? this.drawnPosition() : undefined;
    if (this.eid !== undefined && this.eid !== eid) releaseAdoptedEntities(this.sim);
    if (eid === undefined || !adoptEntity(this.sim, replica, eid)) {
      this.stop();
      return;
    }
    this.eid = eid;
    this.reconciliations += 1;
    this.replayFrom(replica.tick, eid);
    // What was drawn held what is left of earlier corrections; the new one replaces them, measured from the bare prediction.
    this.correction = ZERO;
    if (!drawnBefore) return;
    const predictedNow = this.drawnPosition();
    const correction = { x: drawnBefore.x - predictedNow.x, y: drawnBefore.y - predictedNow.y };
    const length = Math.hypot(correction.x, correction.y);
    this.largestCorrectionMetres = Math.max(this.largestCorrectionMetres, length);
    this.correction = length > SNAP_DISTANCE_METRES || length < NEGLIGIBLE_CORRECTION_METRES ? ZERO : correction;
  }

  /** `frame` with the local player where the prediction has it, heading included; `frame` itself while not predicting or when it does not draw the player. */
  withLocalPlayer(frame: ViewFrame): ViewFrame {
    const eid = this.eid;
    if (eid === undefined || !frame.renderables.some((renderable) => renderable.eid === eid)) return frame;
    const drawn = this.drawnPosition();
    const renderables = frame.renderables.map((renderable) => (renderable.eid === eid ? { ...renderable, x: drawn.x, y: drawn.y } : renderable));
    const heading: Heading | undefined = getHeading(this.sim, eid);
    if (!heading) return { ...frame, renderables };
    return { ...frame, renderables, headings: new Map(frame.headings).set(eid, heading) };
  }

  /**
   * The adopted player stands at server tick `serverTick`. Steps it up to
   * the current client tick: from the client tick that server tick stands
   * for when an acknowledgement has tied the two timelines, else from the
   * oldest move still unacknowledged (before any acknowledgement the player
   * stood still, so nothing happened before that move). Never more than
   * `MAX_PREDICTION_TICKS`, and a move older than that is given up.
   */
  private replayFrom(serverTick: number, eid: number): void {
    const oldestTick = this.clientTick - MAX_PREDICTION_TICKS;
    this.moves = this.moves.filter((move) => move.clientTick > oldestTick);
    const standsFor = this.serverTicksAhead === undefined ? (this.moves[0]?.clientTick ?? this.clientTick) : serverTick - this.serverTicksAhead;
    const firstTick = Math.min(this.clientTick, Math.max(oldestTick, standsFor));
    let late = this.moves.filter((move) => move.clientTick < firstTick).map((move) => move.command);
    this.beforeLastStep = this.positionOf(eid);
    for (let tick = firstTick; tick < this.clientTick; tick += 1) {
      if (tick === this.clientTick - 1) this.beforeLastStep = this.positionOf(eid);
      this.sim.step([...late, ...this.movesMadeIn(tick)]);
      late = [];
    }
    this.predicted = this.positionOf(eid);
    this.lateCommands = late;
    this.ticksAhead = this.clientTick - firstTick;
  }

  private movesMadeIn(clientTick: number): MoveCommand[] {
    return this.moves.filter((move) => move.clientTick === clientTick).map((move) => move.command);
  }

  /** Where the player is drawn: between the last two predicted positions by how far the frame is into its tick, plus what is left of the correction. */
  private drawnPosition(): Point {
    return {
      x: this.beforeLastStep.x + (this.predicted.x - this.beforeLastStep.x) * this.tickFraction + this.correction.x,
      y: this.beforeLastStep.y + (this.predicted.y - this.beforeLastStep.y) * this.tickFraction + this.correction.y,
    };
  }

  /** Where the prediction has the player. Throws when it has none or the position is not finite: the caller stops predicting. */
  private positionOf(eid: number): Point {
    const renderable = getRenderables(this.sim).find((candidate) => candidate.eid === eid);
    if (!renderable || !Number.isFinite(renderable.x) || !Number.isFinite(renderable.y)) throw new Error('the prediction lost the local player');
    return { x: renderable.x, y: renderable.y };
  }
}

/** What is left of a correction after `seconds`: it halves every `CORRECTION_HALF_LIFE_SECONDS` and ends at zero. */
function fade(correction: Point, seconds: number): Point {
  if (correction === ZERO) return ZERO;
  const share = 0.5 ** (seconds / CORRECTION_HALF_LIFE_SECONDS);
  const faded = { x: correction.x * share, y: correction.y * share };
  return Math.hypot(faded.x, faded.y) < NEGLIGIBLE_CORRECTION_METRES ? ZERO : faded;
}

/** The acknowledgement behind an untrusted payload, or undefined when it is not one: a positive safe-integer sequence and tick. */
function readMoveApplied(payload: unknown): MoveAppliedMessage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { sequence, tick } = payload as Record<string, unknown>;
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 1 || !Number.isSafeInteger(tick) || (tick as number) < 1) return undefined;
  return { sequence: sequence as number, tick: tick as number };
}

export const __testing__ = { readMoveApplied };
