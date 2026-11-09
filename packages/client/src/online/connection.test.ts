import { WIRE } from '@novaland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testing__, WorldConnection, type ConnectionStatus, type WorldConnectionHandlers } from './connection';
import { matchMakeError, scriptedJoin, type JoinOutcome } from './fakeRoom';
import { FULL_WORLD_RETRY_MS, RECONNECT_DELAYS_MS, WELCOME_TIMEOUT_MS } from './tuning';

const { isWorldFullRefusal } = __testing__;
const WELCOME = { slot: 2, level: 'starter', capacity: 1024, state: { kind: 'full', tick: 1, entities: [] } };

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
    expect(connection.status).toEqual({ kind: 'disconnected', retryAt: Date.now() + RECONNECT_DELAYS_MS[0]!, attempt: 0 });
    expect(connection.sendMove({ x: 1, y: 0 })).toBe(false);
    first.receive(WIRE.delta, { stale: true });
    expect(handlers.onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    const second = rooms[1]!;
    expect(second).not.toBe(first);
    second.receive(WIRE.welcome, { ...WELCOME, slot: 4 });
    expect(connection.status).toEqual({ kind: 'online', slot: 4 });
    first.drop(1006);
    expect(connection.status).toEqual({ kind: 'online', slot: 4 });
    expect(statuses.map((status) => status.kind)).toEqual(['connecting', 'online', 'disconnected', 'connecting', 'online']);
  });

  it('drops a room that never welcomes and tries again', async () => {
    const { connection, rooms, endpoints } = connect(['room', 'room']);
    await settle();
    await vi.advanceTimersByTimeAsync(WELCOME_TIMEOUT_MS);
    expect(rooms[0]!.left).toBe(true);
    expect(connection.status.kind).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    expect(endpoints).toHaveLength(2);
    expect(rooms[1]!.left).toBe(false);
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

/** Lets a join promise resolve and its handlers attach (no timers involved). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
