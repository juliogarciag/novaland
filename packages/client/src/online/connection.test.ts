import { WIRE } from '@novaland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testing__, WorldConnection, type ConnectionStatus, type WorldConnectionHandlers } from './connection';
import { matchMakeError, scriptedJoin, type JoinOutcome } from './fakeRoom';
import { FULL_WORLD_RETRY_MS, IDLE_KICK_CODE, JOIN_TIMEOUT_MS, LATENCY_INTERVAL_MS, RECONNECT_DELAYS_MS } from './tuning';

const { isWorldFullRefusal } = __testing__;

describe('WorldConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins, is online once the welcome is accepted, and forwards updates only from then on', async () => {
    const { connection, rooms, statuses, handlers } = connect(['room']);
    expect(statuses).toEqual([{ kind: 'connecting', attempt: 1 }]);
    await settle();
    const room = rooms[0]!;
    room.receive(WIRE.delta, { kind: 'delta' });
    expect(handlers.onUpdate).not.toHaveBeenCalled();
    room.receive(WIRE.welcome, WELCOME);
    expect(handlers.onWelcome).toHaveBeenCalledWith(WELCOME);
    expect(connection.status).toEqual({ kind: 'online', slot: 2 });
    room.receive(WIRE.delta, { kind: 'delta', fromTick: 1 });
    room.receive(WIRE.state, { kind: 'full', tick: 9 });
    expect(handlers.onUpdate.mock.calls).toEqual([[{ kind: 'delta', fromTick: 1 }], [{ kind: 'full', tick: 9 }]]);
  });

  it('sends a move as exactly { x, y } while online, and nothing before', async () => {
    const { connection, rooms } = connect(['room']);
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
    await settle();
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
    rooms[0]!.receive(WIRE.welcome, WELCOME);
    expect(connection.sendMove({ x: 1, y: -1 })).toBe(true);
    expect(connection.sendResync()).toBe(true);
    expect(rooms[0]!.sent).toEqual([
      { type: WIRE.move, payload: { x: 1, y: -1 } },
      { type: WIRE.resync, payload: undefined },
    ]);
  });

  it('shows a full world and asks again by itself, or at once on retryNow', async () => {
    const { connection, rooms, statuses, endpoints } = connect(['full', 'full', 'room']);
    await settle();
    expect(connection.status).toEqual({ kind: 'full', retryAt: Date.now() + FULL_WORLD_RETRY_MS });
    await vi.advanceTimersByTimeAsync(FULL_WORLD_RETRY_MS);
    expect(endpoints).toHaveLength(2);
    expect(connection.status.kind).toBe('full');
    connection.retryNow();
    await settle();
    expect(endpoints).toHaveLength(3);
    rooms[0]!.receive(WIRE.welcome, WELCOME);
    expect(statuses.map((status) => status.kind)).toEqual(['connecting', 'full', 'connecting', 'full', 'connecting', 'online']);
  });

  it('treats an unreachable server, and one still booting, as disconnected and retries with a growing wait', async () => {
    const { connection, endpoints, statuses } = connect(['unreachable', 'booting', 'unreachable', 'unreachable', 'unreachable', 'room']);
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await settle();
      const status = connection.status;
      expect(status.kind).toBe('disconnected');
      if (status.kind === 'disconnected') {
        expect(status.attempt).toBe(attempt);
        waits.push(status.retryAt - Date.now());
        await vi.advanceTimersByTimeAsync(status.retryAt - Date.now());
      }
    }
    expect(waits).toEqual([...RECONNECT_DELAYS_MS, RECONNECT_DELAYS_MS.at(-1)]);
    expect(endpoints).toHaveLength(6);
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', attempt: 6 });
  });

  it('comes back after a drop with a fresh join and the new seat, ignoring the dead room from then on', async () => {
    const { connection, rooms, handlers, statuses } = connect(['room', 'room']);
    await settle();
    const first = rooms[0]!;
    first.receive(WIRE.welcome, WELCOME);
    first.drop(1006);
    expect(connection.status).toEqual({ kind: 'disconnected', retryAt: Date.now() + RECONNECT_DELAYS_MS[0]!, attempt: 1 });
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
    first.receive(WIRE.delta, { stale: true });
    expect(handlers.onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    const second = rooms[1]!;
    expect(second).not.toBe(first);
    second.receive(WIRE.welcome, { ...WELCOME, slot: 4 });
    expect(connection.status).toEqual({ kind: 'online', slot: 4 });
    first.drop(1006);
    first.receive(WIRE.welcome, { ...WELCOME, slot: 1 });
    expect(connection.status).toEqual({ kind: 'online', slot: 4 });
    expect(handlers.onWelcome).toHaveBeenCalledTimes(2);
    expect(statuses.map((status) => status.kind)).toEqual(['connecting', 'online', 'disconnected', 'connecting', 'online']);
  });

  it('stays away after the server frees an idle seat (close 4100), and rejoins only when asked', async () => {
    const { connection, rooms, endpoints, statuses, handlers } = connect(['room', 'room']);
    await settle();
    const kicked = rooms[0]!;
    kicked.receive(WIRE.welcome, WELCOME);
    kicked.drop(IDLE_KICK_CODE);
    expect(connection.status).toEqual({ kind: 'away' });
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
    kicked.receive(WIRE.delta, { stale: true });
    expect(handlers.onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpoints).toHaveLength(1);
    connection.retryNow();
    await settle();
    expect(endpoints).toHaveLength(2);
    expect(connection.status).toEqual({ kind: 'connecting', attempt: 1 });
    rooms[1]!.receive(WIRE.welcome, { ...WELCOME, slot: 0 });
    expect(connection.status).toEqual({ kind: 'online', slot: 0 });
    expect(statuses.map((status) => status.kind)).toEqual(['connecting', 'online', 'away', 'connecting', 'online']);
  });

  it('stays away after a 4100 that comes before the welcome, past the join timeout too', async () => {
    const { connection, rooms, endpoints } = connect(['room', 'room']);
    await settle();
    rooms[0]!.drop(IDLE_KICK_CODE);
    expect(connection.status).toEqual({ kind: 'away' });
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + 60_000);
    expect(endpoints).toHaveLength(1);
    expect(connection.status).toEqual({ kind: 'away' });
    connection.retryNow();
    // Attempt 1, not 2: the kick reset the count, so the rejoin reads as a fresh start.
    expect(connection.status).toEqual({ kind: 'connecting', attempt: 1 });
  });

  it('still comes back by itself after every other close code, Colyseus\'s own and unknown room codes included', async () => {
    for (const code of [1000, 1006, 4000, 4002, IDLE_KICK_CODE + 1]) {
      const { connection, rooms, endpoints } = connect(['room', 'room']);
      await settle();
      rooms[0]!.receive(WIRE.welcome, WELCOME);
      rooms[0]!.drop(code);
      expect(connection.status, `close ${code}`).toEqual({ kind: 'disconnected', retryAt: Date.now() + RECONNECT_DELAYS_MS[0]!, attempt: 1 });
      await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
      expect(endpoints, `close ${code}`).toHaveLength(2);
      connection.close();
    }
  });

  it('abandons a room that never welcomes, even one whose server never closes the socket, and tries again', async () => {
    const { connection, rooms, endpoints, handlers } = connect(['room', 'room']);
    await settle();
    const silent = rooms[0]!;
    silent.closesOnLeave = false;
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    expect(silent.left).toBe(true);
    expect(connection.status).toEqual({ kind: 'disconnected', retryAt: Date.now() + RECONNECT_DELAYS_MS[0]!, attempt: 1 });
    silent.receive(WIRE.welcome, WELCOME); // too late: the welcome of an abandoned room means nothing
    expect(handlers.onWelcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    expect(endpoints).toHaveLength(2);
    expect(rooms[1]!.left).toBe(false);
    rooms[1]!.receive(WIRE.welcome, WELCOME);
    expect(connection.status).toEqual({ kind: 'online', slot: 2 });
  });

  it('abandons a join that never settles and tries again', async () => {
    const { connection, endpoints } = connect(['hangs', 'room']);
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS - 1);
    expect(connection.status).toEqual({ kind: 'connecting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.status.kind).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    expect(endpoints).toHaveLength(2);
    expect(connection.status).toEqual({ kind: 'connecting', attempt: 2 });
  });

  it('does not let a full world grow the wait of a later connection failure', async () => {
    const { connection } = connect(['full', 'full', 'full', 'unreachable']);
    for (let full = 0; full < 3; full += 1) {
      await settle();
      expect(connection.status.kind).toBe('full');
      await vi.advanceTimersByTimeAsync(FULL_WORLD_RETRY_MS);
    }
    await settle();
    expect(connection.status).toEqual({ kind: 'disconnected', retryAt: Date.now() + RECONNECT_DELAYS_MS[0]!, attempt: 1 });
  });

  it('leaves a room whose join settles only after close()', async () => {
    const { connection, rooms } = connect(['room']);
    connection.close();
    await settle();
    expect(rooms[0]!.left).toBe(true);
    expect(connection.status.kind).toBe('connecting');
  });

  it('stops for good on a welcome the world cannot use', async () => {
    const { connection, rooms, endpoints, statuses } = connect(['room'], () => ({ incompatible: 'no such level' }));
    await settle();
    rooms[0]!.receive(WIRE.welcome, WELCOME);
    expect(connection.status).toEqual({ kind: 'incompatible', reason: 'no such level' });
    expect(rooms[0]!.left).toBe(true);
    connection.retryNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpoints).toHaveLength(1);
    expect(statuses.at(-1)?.kind).toBe('incompatible');
  });

  it('leaves and never comes back once closed', async () => {
    const { connection, rooms, endpoints } = connect(['room']);
    await settle();
    rooms[0]!.receive(WIRE.welcome, WELCOME);
    connection.close();
    expect(rooms[0]!.left).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpoints).toHaveLength(1);
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
  });

  it('has no latency until seated, pings one interval after the welcome and reports the round trip the server answered', async () => {
    const { connection, rooms } = connect(['room']);
    await settle();
    const room = rooms[0]!;
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    expect(room.unansweredPings).toBe(0);
    room.receive(WIRE.welcome, WELCOME);
    // Not at once: the page is building the game right after the welcome.
    expect(room.unansweredPings).toBe(0);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    expect(room.unansweredPings).toBe(1);
    expect(connection.latencyMs).toBeUndefined();
    room.answerPing(37);
    expect(connection.latencyMs).toBe(37);
  });

  it('measures again every interval, one ping at a time', async () => {
    const { connection, room } = await seatedAndMeasured(37);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    expect(room.unansweredPings).toBe(1);
    room.answerPing(52);
    expect(connection.latencyMs).toBe(52);
    // An unanswered ping is not joined by a second one, however long it waits.
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 3);
    expect(room.unansweredPings).toBe(1);
  });

  it('shows how long an unanswered ping has waited once that is longer than the last round trip', async () => {
    const { connection, room } = await seatedAndMeasured(40);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(25);
    expect(connection.latencyMs).toBe(40);
    await vi.advanceTimersByTimeAsync(2475);
    expect(connection.latencyMs).toBe(2500);
    room.answerPing(2500);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.answerPing(45);
    expect(connection.latencyMs).toBe(45);
  });

  it('tries again at the next interval when a ping could not be sent, instead of waiting for an answer that cannot come', async () => {
    const { connection, room } = await seatedAndMeasured(40);
    room.sendsPings = false;
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 3);
    expect(room.unansweredPings).toBe(0);
    expect(connection.latencyMs).toBe(40);
    room.sendsPings = true;
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.answerPing(44);
    expect(connection.latencyMs).toBe(44);
  });

  it('keeps measuring as it was when the room welcomes a second time', async () => {
    const { connection, room } = await seatedAndMeasured(40);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.receive(WIRE.welcome, WELCOME);
    expect(room.unansweredPings).toBe(1);
    expect(connection.latencyMs).toBe(40);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    expect(room.unansweredPings).toBe(1);
  });

  it('forgets the latency when the connection drops and measures the next seat afresh', async () => {
    const { connection, room, rooms } = await seatedAndMeasured(37);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.drop();
    expect(connection.latencyMs).toBeUndefined();
    // The dropped room answers late: that round trip belongs to a seat that is gone.
    room.answerPing(999);
    expect(connection.latencyMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    await settle();
    rooms[1]!.receive(WIRE.welcome, WELCOME);
    expect(connection.latencyMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    rooms[1]!.answerPing(21);
    expect(connection.latencyMs).toBe(21);
  });

  it('ignores an answer from the room of an earlier seat once the new seat is being measured', async () => {
    const { connection, room, rooms } = await seatedAndMeasured(37);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    await settle();
    rooms[1]!.receive(WIRE.welcome, WELCOME);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    rooms[1]!.answerPing(21);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.answerPing(999);
    expect(connection.latencyMs).toBe(21);
    expect(rooms[1]!.unansweredPings).toBe(1);
  });

  it('has no latency and sends no more pings once the server freed the seat of an idle player', async () => {
    const { connection, room } = await seatedAndMeasured(37);
    room.drop(IDLE_KICK_CODE);
    expect(connection.status).toEqual({ kind: 'away' });
    expect(connection.latencyMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 3);
    expect(room.unansweredPings).toBe(0);
  });

  it('ignores a round trip that is not a non-negative finite number, and stops pinging once closed', async () => {
    const { connection, rooms } = connect(['room']);
    await settle();
    const room = rooms[0]!;
    room.receive(WIRE.welcome, WELCOME);
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.answerPing(Number.NaN);
    expect(connection.latencyMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
    room.answerPing(-5);
    expect(connection.latencyMs).toBeUndefined();
    connection.close();
    await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS * 3);
    expect(room.unansweredPings).toBe(0);
    expect(connection.latencyMs).toBeUndefined();
  });

  it('is given the endpoint it was created for', async () => {
    const { endpoints } = connect(['room']);
    await settle();
    expect(endpoints).toEqual(['ws://world.test:5118']);
  });
});

describe('isWorldFullRefusal', () => {
  it('recognises the locked room the matchmaker answers for a full world, and the room guard\'s own refusal', () => {
    expect(isWorldFullRefusal(matchMakeError('room "world" is locked'))).toBe(true);
    expect(isWorldFullRefusal(matchMakeError('world-full'))).toBe(true);
  });

  it('does not mistake a booting server, a network failure or junk for a full world', () => {
    expect(isWorldFullRefusal(matchMakeError('room "world" not found'))).toBe(false);
    expect(isWorldFullRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isWorldFullRefusal(Object.assign(new Error('room "world" is locked'), { code: 520 }))).toBe(false);
    expect(isWorldFullRefusal(undefined)).toBe(false);
    expect(isWorldFullRefusal('locked')).toBe(false);
  });
});

// ---- Helpers ----

const WELCOME = { slot: 2, level: 'starter', capacity: 1024, state: { kind: 'full', tick: 1, entities: [] } };

function connect(outcomes: readonly JoinOutcome[], onWelcome: WorldConnectionHandlers['onWelcome'] = () => 'seated') {
  const script = scriptedJoin(outcomes);
  const statuses: ConnectionStatus[] = [];
  const handlers = {
    onWelcome: vi.fn(onWelcome),
    onUpdate: vi.fn(),
    onStatus: vi.fn((status: ConnectionStatus) => {
      statuses.push(status);
    }),
  };
  const connection = new WorldConnection({ endpoint: 'ws://world.test:5118', handlers, join: script.join });
  connection.connect();
  return { connection, handlers, statuses, rooms: script.rooms, endpoints: script.endpoints };
}

/** A connection that is seated and whose first ping the server answered in `milliseconds`. */
async function seatedAndMeasured(milliseconds: number) {
  const connected = connect(['room']);
  await settle();
  const room = connected.rooms[0]!;
  room.receive(WIRE.welcome, WELCOME);
  await vi.advanceTimersByTimeAsync(LATENCY_INTERVAL_MS);
  room.answerPing(milliseconds);
  return { ...connected, room };
}

/** Lets a join promise resolve and its handlers attach (no timers involved). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
