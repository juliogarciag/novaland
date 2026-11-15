import { ClientState, type Client as ServerClient } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import {
  applyWorldState,
  createReplica,
  getPlayerPosition,
  getTileDef,
  readMapTiles,
  spawnPoint,
  tileCentre,
  tileDefIdAt,
  WIRE,
  WIRE_PROTOCOL,
  worldMap,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateUpdate,
} from '@novaland/sim';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPlayerKey } from './inbound';
import { IDLE_KICK, REPLACED_KICK } from './kicks';
import { openSavedPositions, type SavedPositions } from './savedPositions';
import { __testing__, type WorldServer } from './startWorldServer';
import { JOIN_ACK_TIMEOUT_MS, NEW_PLAYER_SAVE_AFTER_MS, POSITION_SAVE_INTERVAL_MS } from './tuning';
import { WorldRoom, type Clock } from './WorldRoom';

/**
 * Players who come back (#55, ADR 0014), from the network side: a real
 * Colyseus server on a free port and real SDK clients that present a player
 * token when they join, as the browser does.
 */
describe('a player who joins again', () => {
  afterEach(async () => {
    for (const player of players.splice(0)) await player.room.leave().catch(() => undefined);
    await server?.stop();
    server = undefined;
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('is put back where they left, while a player with another token and one with none spawn as new', async () => {
    const clock = fakeClock();
    server = await startWorldServer({ port: 0, seed: 1, clock });
    const token = newToken();
    const first = await join(server.port, { playerToken: token });
    expect(distanceFromSpawn(positionOf(first))).toBeLessThan(NEAR_SPAWN_METRES);
    const left = await walkEast(first);
    expect(distanceFromSpawn(left)).toBeGreaterThan(NEAR_SPAWN_METRES);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    await leave(first);

    const back = await join(server.port, { playerToken: token });
    expect(positionOf(back)).toEqual(left);
    const stranger = await join(server.port, { playerToken: newToken() });
    expect(distanceFromSpawn(positionOf(stranger))).toBeLessThan(NEAR_SPAWN_METRES);
    const anonymous = await join(server.port);
    expect(distanceFromSpawn(positionOf(anonymous))).toBeLessThan(NEAR_SPAWN_METRES);
  });

  it('is put back where they left after the server process is replaced, when the positions are kept on disk', async () => {
    const directory = temporaryDirectory();
    const clock = fakeClock();
    const token = newToken();
    const firstStore = openSavedPositions({ directory });
    server = await startWorldServer({ port: 0, seed: 1, clock, savedPositions: firstStore });
    const first = await join(server.port, { playerToken: token });
    const left = await walkEast(first);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    // The player never leaves: the server stops under them, as a deploy does.
    await waitForUpdates(first, 2);
    await server.stop();
    firstStore.close();

    const secondStore = track(openSavedPositions({ directory }));
    expect(secondStore.kind).toBe('disk');
    server = await startWorldServer({ port: 0, seed: 2, savedPositions: secondStore });
    const back = await join(server.port, { playerToken: token });
    expect(positionOf(back)).toEqual(left);
  });

  it(`saves where a seated player stands every ${POSITION_SAVE_INTERVAL_MS / 1000} seconds, so a crash loses little`, async () => {
    const clock = fakeClock();
    const store = track(openSavedPositions());
    server = await startWorldServer({ port: 0, seed: 1, clock, savedPositions: store });
    const token = newToken();
    const walker = await join(server.port, { playerToken: token });
    const stopped = await walkEast(walker);
    expect(store.count).toBe(0);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS + POSITION_SAVE_INTERVAL_MS);
    await waitUntil(() => store.count === 1);
    // Still seated: nothing but the clock made the room write.
    expect(store.find(keyOf(token))).toEqual(stopped);
  });

  it(`does not remember a new player who leaves within ${NEW_PLAYER_SAVE_AFTER_MS / 1000} seconds, so a flood of fresh tokens adds nothing to the store`, async () => {
    const store = track(openSavedPositions());
    server = await startWorldServer({ port: 0, seed: 1, savedPositions: store });
    for (let round = 0; round < 25; round += 1) await leave(await join(server.port, { playerToken: newToken() }));
    expect(server.room.seatsTaken).toBe(0);
    expect(store.count).toBe(0);
  });

  it(`gives the player to the newest join of a token: the older session is closed with ${REPLACED_KICK.code} "${REPLACED_KICK.reason}", and the world holds one player, where they stood`, async () => {
    server = await startWorldServer({ port: 0, seed: 1 });
    const token = newToken();
    const firstTab = await join(server.port, { playerToken: token });
    const stood = await walkEast(firstTab);
    const secondTab = await join(server.port, { playerToken: token });
    expect(await orTimeout(firstTab.left, 'the first tab was never closed')).toEqual({ code: REPLACED_KICK.code, reason: REPLACED_KICK.reason });
    await waitForUpdates(secondTab, 3);
    expect(server.room.seatsTaken).toBe(1);
    expect(playerCount(secondTab.replica)).toBe(1);
    // Taken over where the player stood, though they were seated too briefly for the store to know them.
    expect(positionOf(secondTab)).toEqual(stood);
    // And the first tab can take the player back: again one player, in the same place.
    const firstTabAgain = await join(server.port, { playerToken: token });
    expect((await orTimeout(secondTab.left, 'the second tab was never closed')).code).toBe(REPLACED_KICK.code);
    await waitForUpdates(firstTabAgain, 3);
    expect(server.room.seatsTaken).toBe(1);
    expect(playerCount(firstTabAgain.replica)).toBe(1);
    expect(positionOf(firstTabAgain)).toEqual(stood);
  });

  it('is put back where they stood when the server freed their seat for being idle', async () => {
    const clock = fakeClock();
    server = await startWorldServer({ port: 0, seed: 1, clock, idleTimeoutMs: NEW_PLAYER_SAVE_AFTER_MS });
    const token = newToken();
    const idler = await join(server.port, { playerToken: token });
    const stood = await walkEast(idler);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    expect((await orTimeout(idler.left, 'the idle player was never kicked')).code).toBe(IDLE_KICK.code);
    const back = await join(server.port, { playerToken: token });
    expect(positionOf(back)).toEqual(stood);
  });

  it('never sends the token or the key made from it to any client, and never logs either', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => void logged.push(parts.map(String).join(' ')));
    const clock = fakeClock();
    server = await startWorldServer({ port: 0, seed: 1, clock, idleTimeoutMs: NEW_PLAYER_SAVE_AFTER_MS });
    const token = newToken();
    const watcher = await join(server.port, { playerToken: newToken() });
    const first = await join(server.port, { playerToken: token });
    await walkEast(first);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    await leave(first);
    // Back, then replaced by a second tab, then kicked for being idle: every path that handles the key.
    const back = await join(server.port, { playerToken: token });
    const secondTab = await join(server.port, { playerToken: token });
    await orTimeout(back.left, 'the replaced tab was never closed');
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    await orTimeout(secondTab.left, 'the idle tab was never kicked');
    await server.stop();
    server = undefined;
    const everythingSeen = JSON.stringify([watcher.messages, first.messages, back.messages, secondTab.messages, logged]);
    expect(logged.some((line) => line.includes('world-room-idle-kick'))).toBe(true);
    expect(everythingSeen).not.toContain(token);
    expect(everythingSeen).not.toContain(keyOf(token));
  });
});

/**
 * The join as the room sees it, without a network: the options are whatever
 * a client put in the matchmaking request, and none of it may place a player.
 */
describe('a forged or malformed join', () => {
  it('fuzzed with 600 random join options, never throws anything but a protocol refusal and never places a player away from the spawn', async () => {
    const random = seededRandom(55);
    const store = openSavedPositions();
    // A known player stands far from the spawn: the place a forged join would like to appear at.
    const knownToken = newToken();
    const faraway = walkablePointFarFromSpawn();
    store.save(keyOf(knownToken), faraway);
    const room = new WorldRoom();
    await room.onCreate({ seed: 3, savedPositions: store });
    let seated = 0;
    try {
      for (let round = 0; round < 600; round += 1) {
        const options = randomJoinOptions(random, faraway);
        const client = fakeClient(`fuzz-${round}`);
        let refusal: unknown;
        await room.onJoin(client, options).catch((error: unknown) => {
          refusal = error;
        });
        if (refusal !== undefined) {
          expect(String((refusal as Error).message), describe_(options)).toBe('protocol-mismatch');
          expect(room.seatsTaken).toBe(0);
          continue;
        }
        seated += 1;
        const welcome = client.sent[0]?.[1] as WelcomeMessage;
        const own = welcome.state.entities.find((entity) => entity.components['Player']?.['slot'] === welcome.slot);
        const position = own?.components['Position'] as { x: number; y: number } | undefined;
        expect(position && distanceFromSpawn(position) < NEAR_SPAWN_METRES, `${describe_(options)} appeared at ${JSON.stringify(position)}`).toBe(true);
        expect(JSON.stringify(client.sent)).not.toContain(knownToken);
        room.onLeave(client);
      }
      expect(seated).toBeGreaterThan(200);
      expect(store.count).toBe(1);
      expect(store.find(keyOf(knownToken))).toEqual(faraway);
      // The real token still works after all of that: only it opens that place.
      const owner = fakeClient('owner');
      await room.onJoin(owner, { protocol: WIRE_PROTOCOL, playerToken: knownToken });
      const welcome = owner.sent[0]?.[1] as WelcomeMessage;
      const own = welcome.state.entities.find((entity) => entity.components['Player']?.['slot'] === welcome.slot);
      expect(own?.components['Position']).toEqual(faraway);
    } finally {
      room.onDispose();
      store.close();
    }
  });

  it('ends the older of two joins of one token that wait for the same tick: one seat, one player', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 4 });
    try {
      const token = newToken();
      const older = fakeClient('older');
      const newer = fakeClient('newer');
      const olderJoin = room.onJoin(older, { protocol: WIRE_PROTOCOL, playerToken: token });
      const newerJoin = room.onJoin(newer, { protocol: WIRE_PROTOCOL, playerToken: token });
      await expect(olderJoin).rejects.toThrow(REPLACED_KICK.reason);
      await newerJoin;
      expect(older.left).toEqual([[REPLACED_KICK.code, REPLACED_KICK.reason]]);
      expect(older.sent).toEqual([]);
      expect(room.seatsTaken).toBe(1);
      const welcome = newer.sent[0]?.[1] as WelcomeMessage;
      expect(welcome.state.entities.filter((entity) => entity.components['Player'] !== undefined).length).toBe(1);
    } finally {
      room.onDispose();
    }
  });

  it("never saves, under a player's key, where the previous holder of their seat stood", async () => {
    const clock = fakeClock();
    const store = openSavedPositions();
    const room = new WorldRoom();
    await room.onCreate({ seed: 5, clock, savedPositions: store });
    try {
      const earlier = fakeClient('earlier');
      await room.onJoin(earlier, { protocol: WIRE_PROTOCOL, playerToken: newToken() });
      clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
      // The earlier player leaves and a known player takes the same seat and leaves again, all before the next tick: the slot still holds the earlier player's entity.
      const knownToken = newToken();
      const remembered = walkablePointFarFromSpawn();
      store.save(keyOf(knownToken), remembered);
      room.onLeave(earlier);
      const hasty = fakeClient('hasty');
      const hastyJoin = room.onJoin(hasty, { protocol: WIRE_PROTOCOL, playerToken: knownToken });
      room.onLeave(hasty);
      await hastyJoin;
      expect(store.find(keyOf(knownToken))).toEqual(remembered);
    } finally {
      room.onDispose();
      store.close();
    }
  });

  it('saves where everyone still seated stands when the room is disposed', async () => {
    const clock = fakeClock();
    const store = openSavedPositions();
    const room = new WorldRoom();
    await room.onCreate({ seed: 6, clock, savedPositions: store });
    const token = newToken();
    const seated = fakeClient('seated');
    await room.onJoin(seated, { protocol: WIRE_PROTOCOL, playerToken: token });
    const welcome = seated.sent[0]?.[1] as WelcomeMessage;
    const own = welcome.state.entities.find((entity) => entity.components['Player']?.['slot'] === welcome.slot);
    clock.skip(NEW_PLAYER_SAVE_AFTER_MS);
    room.onDispose();
    expect(store.find(keyOf(token))).toEqual(own?.components['Position']);
    store.close();
  });
});

// ---- Helpers ----

/** The room on a bare port: these tests are about the room, not about what stands in front of it. */
const { startBareWorldServer: startWorldServer } = __testing__;

/** Further than any new player appears from the spawn tile: a spawn is at most a few tiles out. */
const NEAR_SPAWN_METRES = 4;

interface Player {
  readonly room: Room;
  readonly welcome: WelcomeMessage;
  readonly replica: ReplicaHandle;
  /** How many world updates were applied to the replica. */
  readonly updates: { count: number };
  /** Every message the server sent this client, as received. */
  readonly messages: unknown[];
  /** Settles when the server closes the connection or the client leaves. */
  readonly left: Promise<{ code: number; reason: string | undefined }>;
}

let server: WorldServer | undefined;
const players: Player[] = [];
const stores: SavedPositions[] = [];
const directories: string[] = [];

/** A token as a browser makes one: 32 random bytes as base64url. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The key the room knows a token's player by. */
function keyOf(token: string): string {
  const key = readPlayerKey({ playerToken: token });
  if (key === undefined) throw new Error('not a player token');
  return key;
}

function track(store: SavedPositions): SavedPositions {
  stores.push(store);
  return store;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'novaland-saved-positions-'));
  directories.push(directory);
  return directory;
}

/** Joins the world the way the browser client does, with whatever else the join should carry, and keeps a replica in step with what the server sends. */
async function join(port: number, extraOptions: Record<string, unknown> = {}): Promise<Player> {
  const room = await new Client(`ws://127.0.0.1:${port}`).joinById('world', { protocol: WIRE_PROTOCOL, ...extraOptions });
  room.reconnection.enabled = false;
  const messages: unknown[] = [];
  const updates = { count: 0 };
  const bound: { replica?: ReplicaHandle } = {};
  const pending: WorldStateUpdate[] = [];
  const onUpdate = (update: WorldStateUpdate): void => {
    messages.push(update);
    if (!bound.replica) return void pending.push(update);
    applyWorldState(bound.replica, update);
    updates.count += 1;
  };
  room.onMessage(WIRE.delta, onUpdate);
  room.onMessage(WIRE.state, onUpdate);
  room.onMessage(WIRE.moveApplied, (message: unknown) => messages.push(message));
  const left = new Promise<Player['left'] extends Promise<infer Left> ? Left : never>((resolve) => room.onLeave((code, reason) => resolve({ code, reason })));
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
  messages.push(welcome);
  const replica = createReplica({ capacity: welcome.capacity });
  applyWorldState(replica, welcome.state);
  for (const update of pending.splice(0)) applyWorldState(replica, update);
  bound.replica = replica;
  const player: Player = { room, welcome, replica, updates, messages, left };
  players.push(player);
  return player;
}

/** Leaves and waits until the server has seen it. */
async function leave(player: Player): Promise<void> {
  const seatsBefore = server?.room.seatsTaken ?? 0;
  await player.room.leave();
  await waitUntil(() => (server?.room.seatsTaken ?? 0) < seatsBefore);
}

/** Where the player's own avatar is, as its own replica has it. */
function positionOf(player: Player): { x: number; y: number } {
  const position = getPlayerPosition(player.replica, player.welcome.slot);
  if (!position) throw new Error(`no player in slot ${player.welcome.slot}`);
  return position;
}

function distanceFromSpawn(position: { x: number; y: number }): number {
  const spawn = spawnPoint(worldMap);
  return Math.hypot(position.x - spawn.x, position.y - spawn.y);
}

/** The centre of a walkable tile at least 30 tiles from the spawn tile: a place no new player is ever put. */
function walkablePointFarFromSpawn(): { x: number; y: number } {
  const tiles = readMapTiles(worldMap);
  const { column: spawnColumn, row: spawnRow } = worldMap.spawn;
  for (let distance = 30; distance < 200; distance += 1) {
    for (const tile of [
      { column: spawnColumn + distance, row: spawnRow },
      { column: spawnColumn - distance, row: spawnRow },
      { column: spawnColumn, row: spawnRow + distance },
      { column: spawnColumn, row: spawnRow - distance },
    ]) {
      const defId = tileDefIdAt(tiles, tile);
      if (defId !== undefined && !getTileDef(defId).solid) return tileCentre(tile);
    }
  }
  throw new Error('the map has no walkable tile 30 to 200 tiles from the spawn');
}

function playerCount(replica: ReplicaHandle): number {
  return replica.snapshot().entities.filter((entity) => entity.components['Player'] !== undefined).length;
}

/** Walks the player east until it has moved, stops it, and returns where it came to rest. */
async function walkEast(player: Player): Promise<{ x: number; y: number }> {
  const start = positionOf(player);
  player.room.send(WIRE.move, { x: 1, y: 0, sequence: 1 });
  await waitUntil(() => Math.abs(positionOf(player).x - start.x) > NEAR_SPAWN_METRES + 2 || (player.updates.count > 40 && positionOf(player).x !== start.x));
  player.room.send(WIRE.move, { x: 0, y: 0, sequence: 2 });
  let resting = positionOf(player);
  let updatesAtRest = player.updates.count;
  await waitUntil(() => {
    const now = positionOf(player);
    if (now.x !== resting.x || now.y !== resting.y) {
      resting = now;
      updatesAtRest = player.updates.count;
    }
    return player.updates.count - updatesAtRest >= 4;
  });
  return resting;
}

function waitForUpdates(player: Player, count: number): Promise<void> {
  const target = player.updates.count + count;
  return waitUntil(() => player.updates.count >= target);
}

async function waitUntil(condition: () => boolean, timeoutMs = JOIN_ACK_TIMEOUT_MS + 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function orTimeout<T>(promise: Promise<T>, message: string, timeoutMs = JOIN_ACK_TIMEOUT_MS + 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/** A clock a test pushes forward: real time plus whatever was skipped. */
function fakeClock(): Clock & { skip(ms: number): void } {
  let skippedMs = 0;
  return {
    now: () => performance.now() + skippedMs,
    skip: (ms) => {
      skippedMs += ms;
    },
  };
}

interface FakeClient extends ServerClient {
  readonly sent: Array<[string, unknown]>;
  readonly left: Array<[number | undefined, string | undefined]>;
}

/** Enough of a Colyseus client for the room's own join and leave paths: a `send` that records and a `leave` that records and closes nothing. */
function fakeClient(sessionId: string): FakeClient {
  const sent: Array<[string, unknown]> = [];
  const left: Array<[number | undefined, string | undefined]> = [];
  return {
    sessionId,
    state: ClientState.JOINED,
    sent,
    left,
    send: (type: string, message: unknown) => sent.push([type, message]),
    leave: (code?: number, reason?: string) => left.push([code, reason]),
  } as unknown as FakeClient;
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

/** How a failing round names its options; a BigInt or a cycle must not break the report. */
function describe_(options: unknown): string {
  try {
    return JSON.stringify(options) ?? String(options);
  } catch {
    return String(options);
  }
}

/**
 * Random join options: most speak the protocol, so they reach the part of
 * the join that reads the token. The token is absent, garbage, nearly a
 * token, or a fresh valid one (never the known player's), and the rest is
 * what someone who wants to choose their spot would try: positions under
 * every name the code uses, a slot, a ready-made key, a whole command.
 */
function randomJoinOptions(random: () => number, wanted: { x: number; y: number }): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const roll = random();
  if (roll < 0.04) return pick([undefined, null, 7, 'join', [], [WIRE_PROTOCOL], true]);
  const options: Record<string, unknown> = { protocol: roll < 0.12 ? pick([0, WIRE_PROTOCOL + 1, String(WIRE_PROTOCOL), null, NaN]) : WIRE_PROTOCOL };
  const tokenRoll = random();
  if (tokenRoll < 0.3) options['playerToken'] = newToken();
  else if (tokenRoll < 0.7) {
    options['playerToken'] = pick<unknown>([
      '',
      'x',
      newToken().slice(1),
      `${newToken()}A`,
      `${newToken().slice(1)}=`,
      `${newToken().slice(2)}%00`,
      'A'.repeat(100_000),
      null,
      42,
      true,
      [newToken()],
      { toString: () => newToken() },
      { length: 43 },
      new String(newToken()),
      10n,
      NaN,
    ]);
  }
  const forgeries: Array<[string, unknown]> = [
    ['returnTo', wanted],
    ['position', wanted],
    ['savedPosition', wanted],
    ['x', wanted.x],
    ['y', wanted.y],
    ['slot', pick([0, 1, 4, -1, 99])],
    ['playerKey', 'k'.repeat(43)],
    ['remembered', true],
    ['seatedAt', -1e12],
    ['type', 'player/join'],
    ['command', { type: 'player/join', slot: 0, returnTo: wanted }],
    ['__proto__', { returnTo: wanted }],
    ['constructor', { prototype: { returnTo: wanted } }],
  ];
  for (const [key, value] of forgeries) {
    if (random() < 0.35) Object.defineProperty(options, key, { value, enumerable: true, configurable: true, writable: true });
  }
  if (random() < 0.03) Object.defineProperty(options, 'playerToken', { get: () => { throw new Error('a throwing accessor'); }, enumerable: true });
  return options;
}
