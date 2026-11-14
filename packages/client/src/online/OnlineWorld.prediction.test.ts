import {
  createPrediction,
  createSim,
  diffWorldState,
  findPlayerEntity,
  getDef,
  getHeading,
  getRenderables,
  TICK_RATE,
  WIRE,
  WIRE_PROTOCOL,
  worldState,
  type Command,
  type MoveAppliedMessage,
  type MoveMessage,
  type SimHandle,
  type WorldState,
} from '@novaland/sim';
import { describe, expect, it, vi } from 'vitest';
import { FakeRoom, scriptedJoin } from './fakeRoom';
import { OnlineWorld } from './OnlineWorld';
import { __testing__ } from './prediction';
import { INTERPOLATION_BUFFER_TICKS, MAX_PREDICTION_TICKS, SNAP_DISTANCE_METRES } from './tuning';

const { readMoveApplied } = __testing__;
const FRAME = 1 / TICK_RATE;
const TICK_MS = 1000 / TICK_RATE;
/** One-way latencies in ticks whose round trips are about 100 ms and 300 ms. */
const ROUND_TRIPS = [
  { name: '100 ms', up: 3, down: 3 },
  { name: '300 ms', up: 9, down: 9 },
] as const;

describe('OnlineWorld predicting the local player', () => {
  it('moves the local player on the frame of the key press, before the server has heard of it, and shows it walking', async () => {
    for (const lag of ROUND_TRIPS) {
      const link = await linked(0, lag);
      const before = link.drawn();
      link.frame([move(1, 0)]);
      const after = link.drawn();
      expect(after.x, lag.name).toBeGreaterThan(before.x);
      expect(link.serverPosition().x, lag.name).toBe(before.x);
      expect(link.drawnHeading().moveIntent, lag.name).toEqual({ x: 1, y: 0 });
      expect(getHeading(link.world.sim, link.eid)?.moveIntent, lag.name).toEqual({ x: 0, y: 0 });
    }
  });

  it('draws the player where the server will put it once it has heard every move: reconciling changes nothing when the server agrees', async () => {
    for (const lag of ROUND_TRIPS) {
      const link = await linked(0, lag);
      const start = link.drawn();
      link.frame([move(1, 0)]);
      link.frames(45);
      link.frame([move(0, 1)]);
      link.frames(30);
      link.frame([move(0, 0)]);
      const stoppedAt = link.drawn();
      // The whole walk was drawn before the server finished it.
      const walked = (45 + 30) * FRAME * speedOf(link);
      expect(Math.abs(stoppedAt.x - start.x) + Math.abs(stoppedAt.y - start.y), lag.name).toBeGreaterThan(walked * 0.9);
      expect(Math.hypot(link.serverPosition().x - stoppedAt.x, link.serverPosition().y - stoppedAt.y), lag.name).toBeGreaterThan(0.1);
      link.frames(lag.up + lag.down + 12);
      const report = link.world.predictionReport!;
      expect(report.predicting, lag.name).toBe(true);
      expect(report.unacknowledgedMoves, lag.name).toBe(0);
      expect(report.reconciliations, lag.name).toBeGreaterThan(20);
      // Same rules, same terrain, same moves in the same ticks: every reconciliation landed where the prediction already was.
      expect(report.largestCorrectionMetres, lag.name).toBeLessThan(1e-9);
      expect(link.drawn(), lag.name).toEqual(link.serverPosition());
      expect(link.drawn(), lag.name).toEqual(link.replicaPosition());
      expect(link.drawn().x, lag.name).toBeCloseTo(stoppedAt.x, 9);
      expect(link.drawn().y, lag.name).toBeCloseTo(stoppedAt.y, 9);
    }
  });

  it('runs ahead of the server by the round trip while walking, and no further', async () => {
    for (const lag of ROUND_TRIPS) {
      const link = await linked(0, lag);
      link.frame([move(1, 0)]);
      link.frames(60);
      const ahead = link.drawn().x - link.replicaPosition().x;
      const perTick = speedOf(link) * FRAME;
      expect(ahead, lag.name).toBeGreaterThan((lag.up + lag.down - 1) * perTick);
      expect(ahead, lag.name).toBeLessThan((lag.up + lag.down + 6) * perTick);
      expect(link.world.predictionReport!.ticksAhead, lag.name).toBeLessThanOrEqual(lag.up + lag.down + 6);
    }
  });

  it('stops at a wall where the server stops, without being pulled back', async () => {
    const link = await linked(0, ROUND_TRIPS[1]);
    link.frame([move(-1, 0.3)]);
    link.frames(600);
    link.frame([move(0, 0)]);
    link.frames(40);
    expect(link.world.predictionReport!.largestCorrectionMetres).toBeLessThan(1e-6);
    expect(link.drawn()).toEqual(link.serverPosition());
  });

  it('keeps every other player on server states, two send intervals behind', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    const other = findPlayerEntity(link.world.sim, 1) as number;
    link.serverCommands.push({ type: 'player/move', slot: 1, x: 1, y: 0 });
    link.frame([move(1, 0)]);
    link.frames(40);
    const frame = link.frame([]);
    const drawnOther = frame.renderables.find((renderable) => renderable.eid === other)!;
    const replicaOther = getRenderables(link.world.sim).find((renderable) => renderable.eid === other)!;
    expect(drawnOther.x).toBeLessThan(replicaOther.x);
    expect(frame.tick).toBeLessThanOrEqual(link.world.sim.tick - INTERPOLATION_BUFFER_TICKS + 3);
    expect(link.drawn().x).toBeGreaterThan(link.replicaPosition().x);
    expect(frame.headings.get(other)?.moveIntent).toEqual({ x: 1, y: 0 });
  });

  it('absorbs jitter as corrections of a tick or two of movement and still ends on the server position', async () => {
    const random = seededRandom(7);
    const link = await linked(0, { up: () => 2 + Math.floor(random() * 5), down: () => 2 + Math.floor(random() * 5) });
    for (let round = 0; round < 12; round += 1) {
      link.frame([move(round % 2 === 0 ? 1 : -1, round % 3 === 0 ? 0.5 : 0)]);
      link.frames(10 + Math.floor(random() * 20));
    }
    link.frame([move(0, 0)]);
    link.frames(40);
    const report = link.world.predictionReport!;
    expect(report.largestCorrectionMetres).toBeGreaterThan(0);
    expect(report.largestCorrectionMetres).toBeLessThan(6 * speedOf(link) * FRAME);
    expect(report.correctionMetres).toBe(0);
    expect(link.drawn()).toEqual(link.serverPosition());
  });

  it('is corrected when the server never applies a move: the guess is given up after a second, smoothly, and the next move works', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    const start = link.drawn();
    link.dropNextMove = true;
    link.frame([move(1, 0)]);
    link.frames(30);
    expect(link.drawn().x - start.x).toBeGreaterThan(2);
    expect(link.serverPosition()).toEqual(start);
    link.frames(MAX_PREDICTION_TICKS - 30 + 3);
    // The move is forgotten; what is left of the guess fades instead of jumping.
    const steps: number[] = [];
    let last = link.drawn().x;
    for (let frame = 0; frame < 60; frame += 1) {
      link.frame([]);
      steps.push(Math.abs(link.drawn().x - last));
      last = link.drawn().x;
    }
    expect(link.drawn()).toEqual(start);
    expect(link.world.predictionReport!.unacknowledgedMoves).toBe(0);
    // Never the whole way in one frame, and over several frames.
    expect(Math.max(...steps)).toBeLessThan(2);
    expect(steps.filter((step) => step > 0.01).length).toBeGreaterThan(5);
    link.frame([move(0, 1)]);
    link.frames(20);
    link.frame([move(0, 0)]);
    link.frames(30);
    expect(link.drawn()).toEqual(link.serverPosition());
    expect(link.drawn().y).toBeGreaterThan(start.y + 1);
  });

  it('follows the server when it moves the player somewhere the client did not predict', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    link.frame([move(1, 0)]);
    link.frames(20);
    // The server alters the outcome: for half a second it walks the player the other way, whatever the client sent.
    for (let tick = 0; tick < 30; tick += 1) {
      link.serverCommands.push({ type: 'player/move', slot: 0, x: -1, y: 0 });
      link.frame([]);
    }
    link.frame([move(0, 0)]);
    link.frames(40);
    expect(link.world.predictionReport!.largestCorrectionMetres).toBeGreaterThan(0.2);
    expect(link.drawn()).toEqual(link.serverPosition());
    expect(link.world.predictionReport!.correctionMetres).toBe(0);
  });

  it('shows a teleport at once instead of sliding across the level', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    const here = link.drawn();
    const state = JSON.parse(JSON.stringify(worldState(link.server))) as WorldState;
    const entity = state.entities.find((candidate) => candidate.id === link.eid)!;
    entity.components.Position = { x: here.x + SNAP_DISTANCE_METRES + 2, y: here.y };
    link.room.receive(WIRE.state, state);
    link.world.nextFrame([], FRAME);
    expect(link.drawn().x).toBe(here.x + SNAP_DISTANCE_METRES + 2);
    expect(link.world.predictionReport!.correctionMetres).toBe(0);
  });

  it('starts over on the new seat after a drop, and predicts the held move there', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    link.frame([move(1, 0)]);
    link.frames(10);
    link.room.drop(1006);
    expect(link.world.predictionReport!.predicting).toBe(false);
    link.world.nextFrame([], FRAME);
    const secondRoom = await nextRoom(link.join, 1);
    link.server.step([
      { type: 'player/leave', slot: 0 },
      { type: 'player/join', slot: 3 },
    ]);
    link.reseat(secondRoom, 3);
    expect(link.world.predictionReport!.predicting).toBe(true);
    expect(secondRoom.sent.map((message) => message.type)).toEqual([WIRE.move]);
    const before = link.drawn();
    link.frames(30);
    expect(link.drawn().x).toBeGreaterThan(before.x + 1);
    link.frame([move(0, 0)]);
    link.frames(60);
    expect(link.drawn()).toEqual(link.serverPosition());
  });

  it('rebuilds from the server state after a hidden tab instead of stepping the whole gap', async () => {
    const link = await linked(0, ROUND_TRIPS[0]);
    link.frame([move(1, 0)]);
    link.frames(10);
    const step = vi.spyOn(link.predictionSim!, 'step');
    link.skipClientTime(60000);
    link.world.nextFrame([], FRAME);
    expect(step.mock.calls.length).toBeLessThanOrEqual(MAX_PREDICTION_TICKS);
    link.frame([move(0, 0)]);
    link.frames(60);
    expect(link.drawn()).toEqual(link.serverPosition());
  });

  it('draws the local player from server states while there is no prediction: before it has loaded, when it cannot load, when it is switched off', async () => {
    const neverLoads = await linked(0, ROUND_TRIPS[0], { createPrediction: () => new Promise(() => undefined) });
    const failsToLoad = await linked(0, ROUND_TRIPS[0], { createPrediction: () => Promise.reject(new Error('offline')) });
    const switchedOff = await linked(0, ROUND_TRIPS[0], { predictsLocalPlayer: false });
    for (const link of [neverLoads, failsToLoad, switchedOff]) {
      expect(link.world.predictionReport).toBeUndefined();
      const before = link.drawn();
      link.frame([move(1, 0)]);
      expect(link.drawn()).toEqual(before);
      link.frames(40);
      expect(link.drawn().x).toBeGreaterThan(before.x);
      expect(link.drawn().x).toBeLessThan(link.replicaPosition().x);
      link.frame([move(0, 0)]);
      link.frames(40);
      expect(link.drawn()).toEqual(link.serverPosition());
    }
  });

  it('drops a prediction that throws and carries on from server states, without failing the frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const link = await linked(0, ROUND_TRIPS[0]);
    link.frame([move(1, 0)]);
    link.frames(5);
    vi.spyOn(link.predictionSim!, 'step').mockImplementation(() => {
      throw new Error('physics fell over');
    });
    expect(() => link.frames(40)).not.toThrow();
    expect(link.world.predictionReport).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    link.frame([move(0, 0)]);
    link.frames(40);
    expect(link.drawn()).toEqual(link.serverPosition());
    warn.mockRestore();
  });

  it('fuzzed with acknowledgements that are garbage, wrong or far from the truth, never throws and ends on the server position', async () => {
    const random = seededRandom(45);
    const link = await linked(0, { up: () => 1 + Math.floor(random() * 8), down: () => 1 + Math.floor(random() * 8) });
    const garbage: unknown[] = [undefined, null, 7, 'ack', [], {}, { sequence: 1 }, { tick: 1 }, { sequence: -1, tick: 5 }, { sequence: 1.5, tick: 5 }, { sequence: 2 ** 60, tick: 2 ** 60 }, { sequence: '1', tick: '2' }, { sequence: NaN, tick: NaN }];
    for (let round = 0; round < 600; round += 1) {
      const commands = random() < 0.08 ? [move(Math.round(random() * 2 - 1), Math.round(random() * 2 - 1))] : [];
      if (random() < 0.3) link.room.receive(WIRE.moveApplied, garbage[Math.floor(random() * garbage.length)]);
      if (random() < 0.3) link.room.receive(WIRE.moveApplied, { sequence: 1 + Math.floor(random() * 80), tick: 1 + Math.floor(random() * 100000) });
      link.frame(commands);
      const drawn = link.drawn();
      expect(Number.isFinite(drawn.x) && Number.isFinite(drawn.y)).toBe(true);
    }
    link.frame([move(0, 0)]);
    link.frames(MAX_PREDICTION_TICKS + 60);
    expect(link.world.predictionReport!.predicting).toBe(true);
    expect(link.drawn()).toEqual(link.serverPosition());
  });
});

describe('readMoveApplied', () => {
  it('accepts a positive safe-integer sequence and tick and nothing else', () => {
    expect(readMoveApplied({ sequence: 3, tick: 90 })).toEqual({ sequence: 3, tick: 90 });
    expect(readMoveApplied({ sequence: 3, tick: 90, extra: true })).toEqual({ sequence: 3, tick: 90 });
    for (const payload of [undefined, null, 3, 'x', [], {}, { sequence: 3 }, { tick: 90 }, { sequence: 0, tick: 90 }, { sequence: 3, tick: 0 }, { sequence: 3.5, tick: 90 }, { sequence: 3, tick: Infinity }, { sequence: '3', tick: 90 }, { sequence: 2 ** 53, tick: 90 }]) {
      expect(readMoveApplied(payload), JSON.stringify(payload)).toBeUndefined();
    }
  });
});

// ---- Helpers ----

type Lag = number | (() => number);

interface LinkOptions {
  readonly up: Lag;
  readonly down: Lag;
}

/**
 * A client and a server sim joined by a link that delays messages by whole
 * ticks, driven one frame (one tick of real time) at a time. The server side
 * does what the world room does: applies the moves that arrived, notes the
 * last one applied, and every third tick sends the acknowledgement (when
 * there is a new one) and then a delta.
 */
class LaggedLink {
  /** Commands the server adds on its own in its next tick. */
  readonly serverCommands: Command[] = [];
  /** The next move the client sends never reaches the server. */
  dropNextMove = false;
  eid: number;
  private frameCount = 0;
  private clientMs = 0;
  private sentMessages = 0;
  private lastSent: WorldState;
  private toAcknowledge: MoveAppliedMessage | undefined;
  private upLink: Array<{ arrivesAt: number; move: MoveMessage }> = [];
  private downLink: Array<{ arrivesAt: number; type: string; payload: unknown }> = [];

  constructor(
    readonly world: OnlineWorld,
    readonly server: SimHandle,
    public room: FakeRoom,
    readonly join: { rooms: FakeRoom[] },
    private slot: number,
    private readonly lag: LinkOptions,
    readonly predictionSims: SimHandle[],
  ) {
    this.lastSent = worldState(server);
    this.eid = findPlayerEntity(server, slot) as number;
  }

  get predictionSim(): SimHandle | undefined {
    return this.predictionSims[0];
  }

  /** The clock the client's prediction reads: from the first frame on, half a tick past each frame, so whole ticks never sit on a rounding edge. */
  now = (): number => this.clientMs + (this.frameCount > 0 ? TICK_MS / 2 : 0);

  skipClientTime(milliseconds: number): void {
    this.clientMs += milliseconds;
  }

  /** One frame of the client with `commands` from the keyboard, then one tick of the server, then whatever the link delivers. */
  frame(commands: readonly Command[]): ReturnType<OnlineWorld['nextFrame']> {
    this.frameCount += 1;
    this.clientMs += TICK_MS;
    const frame = this.world.nextFrame(commands, FRAME);
    for (const message of this.room.sent.slice(this.sentMessages)) {
      if (message.type !== WIRE.move) continue;
      if (this.dropNextMove) this.dropNextMove = false;
      else this.upLink.push({ arrivesAt: this.frameCount + ticksOf(this.lag.up), move: message.payload as MoveMessage });
    }
    this.sentMessages = this.room.sent.length;
    const arrived = this.upLink.filter((message) => message.arrivesAt <= this.frameCount);
    this.upLink = this.upLink.filter((message) => message.arrivesAt > this.frameCount);
    const fromClient: Command[] = arrived.map(({ move: { x, y } }) => ({ type: 'player/move', slot: this.slot, x, y }));
    this.server.step([...fromClient, ...this.serverCommands.splice(0)]);
    const lastArrived = arrived.at(-1);
    if (lastArrived) this.toAcknowledge = { sequence: lastArrived.move.sequence, tick: this.server.tick };
    if (this.server.tick % 3 === 0) {
      // A fixed order of arrival, as on a socket: a later message never overtakes an earlier one.
      const arrivesAt = Math.max(this.frameCount + ticksOf(this.lag.down), this.downLink.at(-1)?.arrivesAt ?? 0);
      if (this.toAcknowledge) this.downLink.push({ arrivesAt, type: WIRE.moveApplied, payload: this.toAcknowledge });
      this.toAcknowledge = undefined;
      const next = worldState(this.server);
      this.downLink.push({ arrivesAt, type: WIRE.delta, payload: roundTrip(diffWorldState(this.lastSent, next)) });
      this.lastSent = next;
    }
    while (this.downLink[0] && this.downLink[0].arrivesAt <= this.frameCount) {
      const message = this.downLink.shift()!;
      this.room.receive(message.type, message.payload);
    }
    return frame;
  }

  frames(count: number): void {
    for (let frame = 0; frame < count; frame += 1) this.frame([]);
  }

  /** The server welcomes the client into `slot` through `room`, as after a reconnect; whatever was on the link is lost. */
  reseat(room: FakeRoom, slot: number): void {
    this.room = room;
    this.slot = slot;
    this.sentMessages = 0;
    this.upLink = [];
    this.downLink = [];
    this.toAcknowledge = undefined;
    this.eid = findPlayerEntity(this.server, slot) as number;
    this.lastSent = worldState(this.server);
    room.receive(WIRE.welcome, roundTrip({ protocol: WIRE_PROTOCOL, slot, level: this.server.level.name, capacity: this.server.capacity, state: this.lastSent }));
    this.sentMessages = 0;
    for (const message of room.sent) this.upLink.push({ arrivesAt: this.frameCount + ticksOf(this.lag.up), move: message.payload as MoveMessage });
    this.sentMessages = room.sent.length;
  }

  /** Where the last frame drew the local player. */
  drawn(): { x: number; y: number } {
    const drawn = this.world.localPlayerDrawnAt;
    if (!drawn) throw new Error('the local player was not drawn');
    return { x: drawn.x, y: drawn.y };
  }

  drawnHeading() {
    const heading = this.world.nextFrame([], 0).headings.get(this.eid);
    if (!heading) throw new Error('the local player has no heading');
    return heading;
  }

  serverPosition(): { x: number; y: number } {
    return positionOf(this.server, this.eid);
  }

  replicaPosition(): { x: number; y: number } {
    return positionOf(this.world.sim, this.eid);
  }
}

/** A world seated in `slot` over a lagged link, with another player in the world, predicting unless the options say otherwise. */
async function linked(slot: number, lag: LinkOptions, options: Partial<Parameters<typeof OnlineWorld.join>[0]> = {}): Promise<LaggedLink> {
  const server = await createSim({ seed: 7 });
  const otherSlot = slot === 0 ? 1 : 0;
  server.step([
    { type: 'player/join', slot: otherSlot },
    { type: 'player/join', slot },
  ]);
  const join = scriptedJoin(['room', 'room', 'room']);
  const predictionSims: SimHandle[] = [];
  const clock = { now: (): number => 0 };
  const { seated } = OnlineWorld.join({
    endpoint: 'ws://world.test',
    join: join.join,
    now: () => clock.now(),
    createPrediction: async (predictionOptions) => {
      const prediction = await createPrediction(predictionOptions);
      predictionSims.push(prediction);
      return prediction;
    },
    ...options,
  });
  const room = await nextRoom(join, 0);
  room.receive(WIRE.welcome, roundTrip({ protocol: WIRE_PROTOCOL, slot, level: server.level.name, capacity: server.capacity, state: worldState(server) }));
  const world = await seated;
  const link = new LaggedLink(world, server, room, join, slot, lag, predictionSims);
  clock.now = link.now;
  const expectsPrediction = options.predictsLocalPlayer !== false && options.createPrediction === undefined;
  const deadline = Date.now() + 5000;
  while (expectsPrediction && !world.predictionReport?.predicting) {
    if (Date.now() > deadline) throw new Error('the prediction never started');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // Lets a prediction that fails to load fail, and the buffer fill, before the test starts.
  await new Promise((resolve) => setTimeout(resolve, 5));
  link.frames(12);
  return link;
}

async function nextRoom(join: { rooms: FakeRoom[] }, index: number): Promise<FakeRoom> {
  const deadline = Date.now() + 3000;
  while (!join.rooms[index]) {
    if (Date.now() > deadline) throw new Error(`room ${index} was never joined`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return join.rooms[index] as FakeRoom;
}

function move(x: number, y: number): Command {
  return { type: 'player/move', slot: 0, x, y };
}

function ticksOf(lag: Lag): number {
  return typeof lag === 'number' ? lag : lag();
}

function positionOf(handle: SimHandle, eid: number): { x: number; y: number } {
  const renderable = getRenderables(handle).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`entity ${eid} is not drawn`);
  return { x: renderable.x, y: renderable.y };
}

/** Metres per second the local player walks at, from its def. */
function speedOf(link: LaggedLink): number {
  const renderable = getRenderables(link.server).find((candidate) => candidate.eid === link.eid)!;
  return getDef(renderable.defId).speed ?? 0;
}

/** What the network does to a payload. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A small deterministic generator (mulberry32), so a failing fuzz round can be replayed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
