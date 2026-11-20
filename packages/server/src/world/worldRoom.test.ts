import { ClientState, ErrorCode, type Client as ServerClient } from '@colyseus/core';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import {
  applyWorldState,
  createReplica,
  findPlayerEntity,
  getCharacter,
  getHeading,
  getRenderables,
  guestCharacter,
  isPlayerDefId,
  JOIN_REFUSAL,
  WIRE,
  WIRE_PROTOCOL,
  readMapTiles,
  tileAt,
  worldMap,
  type Character,
  type Heading,
  type MoveAppliedMessage,
  type Renderable,
  type ReplicaHandle,
  type WelcomeMessage,
  type WorldStateApplyResult,
  type WorldStateUpdate,
} from '@novaland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_KICK } from './kicks';
import { __testing__, type WorldServer } from './startWorldServer';
import {
  CHARACTER_CHANGE_BURST,
  DISCONNECT_MESSAGES_PER_SECOND,
  IDLE_TIMEOUT_MS,
  INBOUND_BURST,
  INBOUND_MESSAGES_PER_SECOND,
  JOIN_ACK_TIMEOUT_MS,
  MAX_CHARACTER_MESSAGE_BYTES,
  MAX_JOIN_OPTIONS_BYTES,
  MAX_FRAME_BYTES,
  MAX_INBOUND_BYTES,
  MAX_SEATS,
  RESYNC_BURST,
  RESYNCS_PER_SECOND,
  WORLD_ROOM_ID,
} from './tuning';
import { WorldRoom, type Clock } from './WorldRoom';

/**
 * The room from the network side: a real Colyseus server on a free port and
 * real SDK clients that build a replica from what they receive, exactly as the
 * browser client will. Every test boots its own server and stops it.
 */
describe('WorldRoom over a real connection', () => {
  afterEach(async () => {
    for (const player of players.splice(0)) await player.room.leave().catch(() => undefined);
    await server?.stop();
    server = undefined;
  });

  it(`seats ${MAX_SEATS} players by room id, each welcomed with its own seat and already in the world`, async () => {
    server = await startWorldServer({ port: 0, seed: 1 });
    expect(server.roomId).toBe(WORLD_ROOM_ID);
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port, guestCharacter(seat)));
    expect(players.map((player) => player.welcome.slot)).toEqual([0, 1, 2, 3, 4]);
    for (const player of players) {
      expect(player.welcome.map).toBe(readMapTiles(worldMap).checksum);
      // Terrain does not travel: the state holds the players who were seated by then and nothing else.
      expect(player.welcome.state.entities).toHaveLength(player.welcome.slot + 1);
      expect(player.welcome.capacity).toBe(player.replica.capacity);
      expect(player.welcome.state.kind).toBe('full');
      expect(findPlayerEntity(player.replica, player.welcome.slot)).toBeDefined();
    }
    // The last welcome holds everybody: the state is taken after the tick that spawned the joiner.
    const last = players[MAX_SEATS - 1] as Player;
    for (let seat = 0; seat < MAX_SEATS; seat += 1) expect(findPlayerEntity(last.replica, seat)).toBeDefined();
    // Each joiner is the character it asked to be, on a spawn tile of its own that the sim picked.
    const characters = playerRenderables(last.replica);
    expect(characters).toHaveLength(MAX_SEATS);
    expect(characters.every((character) => isPlayerDefId(character.defId))).toBe(true);
    for (let seat = 0; seat < MAX_SEATS; seat += 1) expect(characterInSeat(last.replica, seat)).toEqual(guestCharacter(seat));
    expect(new Set(characters.map((character) => tileKeyOf(character))).size).toBe(MAX_SEATS);
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
  });

  it('shows every player the others moving, through deltas that chain without a gap', async () => {
    server = await startWorldServer({ port: 0, seed: 2 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 2);
    const mover = players[0] as Player;
    const before = players.map((player) => positionOf(player.replica, mover.welcome.slot));
    mover.room.send(WIRE.move, { x: 1, y: 0, sequence: 1 });
    await waitUntil(() => players.every((player, index) => positionOf(player.replica, mover.welcome.slot).x > before[index]!.x + 0.1));
    for (const player of players) {
      expect(player.applyResults.every((result) => result === 'applied'), player.applyResults.join(',')).toBe(true);
      expect(player.replica.tick).toBeGreaterThan(player.welcome.state.tick);
      expect(headingOf(player.replica, mover.welcome.slot)).toEqual({ moveIntent: { x: 1, y: 0 }, facing: { x: 1, y: 0 } });
      for (let seat = 1; seat < MAX_SEATS; seat += 1) expect(headingOf(player.replica, seat).moveIntent).toEqual({ x: 0, y: 0 });
    }
    // Every replica draws every avatar where the server put it. Replicas are compared at one tick: each applies its deltas as its socket drains.
    await waitUntil(() => players.every((player) => player.replica.tick === mover.replica.tick));
    for (const player of players) expect(getRenderables(player.replica)).toEqual(getRenderables(mover.replica));
    mover.room.send(WIRE.move, { x: 0, y: 0, sequence: 2 });
    await waitUntil(() => players.every((player) => headingOf(player.replica, mover.welcome.slot).moveIntent.x === 0));
    for (const player of players) expect(headingOf(player.replica, mover.welcome.slot)).toEqual({ moveIntent: { x: 0, y: 0 }, facing: { x: 1, y: 0 } });
  });

  it('seats two players as two different characters, and shows both to each of them', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    const ada: Character = { name: 'Ada', look: { skin: 0, hair: 3, clothes: 1, body: 1, hairStyle: 2 } };
    const jose: Character = { name: 'José 🚀', look: { skin: 4, hair: 0, clothes: 6, body: 0, hairStyle: 1 } };
    players.push(await join(server.port, ada));
    players.push(await join(server.port, jose));
    const [first, second] = players as [Player, Player];
    // The first player learns of the second through a delta; the second got both in its welcome.
    await waitUntil(() => findPlayerEntity(first.replica, 1) !== undefined);
    for (const player of [first, second]) {
      expect(characterInSeat(player.replica, 0)).toEqual(ada);
      expect(characterInSeat(player.replica, 1)).toEqual(jose);
    }
    expect(first.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it('normalises the name at the gate: the world holds what the rule made of it, not what the client sent', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    players.push(await join(server.port, { name: '  Ada   Lovelace ', look: { skin: 1, hair: 1, clothes: 1, body: 0, hairStyle: 0 } }));
    expect(characterInSeat((players[0] as Player).replica, 0)?.name).toBe('Ada Lovelace');
  });

  it('changes a seated player into another character where it stands, for every player, on the same entity', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    const ada: Character = { name: 'Ada', look: { skin: 0, hair: 3, clothes: 1, body: 1, hairStyle: 2 } };
    const grace: Character = { name: 'Grace Hopper', look: { skin: 5, hair: 7, clothes: 4, body: 0, hairStyle: 1 } };
    players.push(await join(server.port, ada));
    players.push(await join(server.port, guestCharacter(1)));
    const [changer, watcher] = players as [Player, Player];
    await waitUntil(() => findPlayerEntity(changer.replica, 1) !== undefined);
    // Walk away from the spawn and stop, so a change that respawned the player would show.
    changer.room.send(WIRE.move, { x: 1, y: 0, sequence: 1 });
    await waitUntil(() => positionOf(watcher.replica, 0).x > positionOf(watcher.replica, 1).x + 1);
    changer.room.send(WIRE.move, { x: 0, y: 0, sequence: 2 });
    await waitUntil(() => headingOf(watcher.replica, 0).moveIntent.x === 0);
    await waitForUpdates([watcher], 3);
    const eidBefore = findPlayerEntity(watcher.replica, 0);
    const positionBefore = positionOf(watcher.replica, 0);

    // The name is normalised at the gate, as a join's is.
    changer.room.send(WIRE.changeCharacter, { character: { ...grace, name: '  Grace   Hopper ' } });
    await waitUntil(() => players.every((player) => characterInSeat(player.replica, 0)?.name === grace.name));
    for (const player of players) {
      expect(characterInSeat(player.replica, 0)).toEqual(grace);
      expect(characterInSeat(player.replica, 1)).toEqual(guestCharacter(1));
      expect(findPlayerEntity(player.replica, 0)).toBe(eidBefore);
      expect(positionOf(player.replica, 0)).toEqual(positionBefore);
    }
    expect(players.every((player) => player.applyResults.every((result) => result === 'applied'))).toBe(true);
  });

  it('drops a character change that is malformed, oversized or names another seat, and changes nobody', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    const ada: Character = { name: 'Ada', look: { skin: 0, hair: 3, clothes: 1, body: 1, hairStyle: 2 } };
    players.push(await join(server.port, ada));
    players.push(await join(server.port, guestCharacter(1)));
    const [sender, other] = players as [Player, Player];
    await waitUntil(() => findPlayerEntity(sender.replica, 1) !== undefined);
    const legal = guestCharacter(3);
    const malformed: unknown[] = [
      undefined,
      null,
      'Ada',
      legal,
      { character: legal, slot: 1 },
      { character: { ...legal, name: '' } },
      { character: { ...legal, name: 'a'.repeat(21) } },
      { character: { ...legal, name: 21 } },
      { character: { ...legal, look: { ...legal.look, hair: 99 } } },
      { character: { ...legal, slot: 1 } },
    ];
    for (const payload of malformed) sender.room.send(WIRE.changeCharacter, payload);
    await waitUntil(() => server!.room.dropped.malformed === malformed.length);
    sender.room.send(WIRE.changeCharacter, { character: { ...legal, name: 'x'.repeat(MAX_CHARACTER_MESSAGE_BYTES) } });
    await waitUntil(() => server!.room.dropped.oversized === 1);
    await waitForUpdates([sender, other], 3);
    for (const player of players) {
      expect(characterInSeat(player.replica, 0)).toEqual(ada);
      expect(characterInSeat(player.replica, 1)).toEqual(guestCharacter(1));
    }
  });

  it('lets a session change character only a few times at once: a flood is dropped and the room goes on', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    players.push(await join(server.port));
    const flooder = players[0] as Player;
    const flood = 20;
    for (let round = 0; round < flood; round += 1) flooder.room.send(WIRE.changeCharacter, { character: { name: `Name ${round}`, look: guestCharacter(0).look } });
    await waitUntil(() => server!.room.dropped.overBudget >= flood - CHARACTER_CHANGE_BURST);
    await waitUntil(() => characterInSeat(flooder.replica, 0)?.name.startsWith('Name ') === true);
    await waitForUpdates([flooder], 3);
    // Only the first few got through: the name is one of theirs, never a later one.
    const applied = Number(characterInSeat(flooder.replica, 0)?.name.slice('Name '.length));
    expect(applied).toBeLessThan(CHARACTER_CHANGE_BURST);
    expect(server.room.dropped.overBudget).toBe(flood - CHARACTER_CHANGE_BURST);
  });

  it('refuses a join without a legal character before it takes a seat, and keeps serving the players it has', async () => {
    server = await startWorldServer({ port: 0, seed: 54 });
    players.push(await join(server.port));
    const watcher = players[0] as Player;
    const legal = guestCharacter(1);
    const malformedCharacters: unknown[] = [
      undefined,
      null,
      'Ada',
      { name: 'Ada' },
      { ...legal, name: 21 },
      { ...legal, name: 'a'.repeat(21) },
      { ...legal, name: '   ' },
      { ...legal, name: 'Ada\nLovelace' },
      { ...legal, look: { skin: 99, hair: 0, clothes: 0, body: 0, hairStyle: 0 } },
      { ...legal, look: { skin: 0, hair: -1, clothes: 0, body: 0, hairStyle: 0 } },
      // A look as a page from before body types and hairstyles sends it: the server never fills them in.
      { ...legal, look: { skin: 0, hair: 0, clothes: 0 } },
      { ...legal, look: { skin: 0, hair: 0, clothes: 0, body: 2, hairStyle: 0 } },
      { ...legal, look: { skin: 0, hair: 0 } },
      { ...legal, slot: 0 },
    ];
    // Each speaks the room's protocol, so it is the character that refuses it; the last one is legal but too big to be read.
    const malformedOptions: unknown[] = [...malformedCharacters.map((character) => ({ protocol: WIRE_PROTOCOL, character })), { protocol: WIRE_PROTOCOL, character: legal, padding: 'x'.repeat(MAX_JOIN_OPTIONS_BYTES) }];
    for (const options of malformedOptions) {
      const refusal = await new Client(`ws://127.0.0.1:${server.port}`).joinById(WORLD_ROOM_ID, options).then(
        (room) => room.leave().then(() => undefined),
        (error: unknown) => error as { code: number; message: string },
      );
      expect(refusal, JSON.stringify(options)).toMatchObject({ code: ErrorCode.APPLICATION_ERROR, message: JOIN_REFUSAL.invalidCharacter });
    }
    expect(server.room.refusedJoins.invalidCharacter).toBe(malformedOptions.length);
    expect(server.room.seatsTaken).toBe(1);
    await waitForUpdates(players, 5);
    expect(playerRenderables(watcher.replica)).toHaveLength(1);
    // The world is as open as before: the next legal join is seated.
    players.push(await join(server.port, legal));
    expect(characterInSeat((players[1] as Player).replica, 1)).toEqual(legal);
  });

  it('tells a player which of its moves the sim applied and in which tick, just before the first update that includes it, and tells nobody else', async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    const mover = await join(server.port);
    const watcher = await join(server.port);
    await waitForUpdates([mover, watcher], 2);
    mover.room.send(WIRE.move, { x: 1, y: 0, sequence: 41 });
    await waitUntil(() => mover.movesApplied.length === 1);
    const first = mover.movesApplied[0]!;
    await waitUntil(() => mover.updates.length > first.updatesBefore);
    expect(first.message.sequence).toBe(41);
    // The update right after the acknowledgement is the first state with the move in it, taken at or after the tick that applied it.
    const before = mover.updates[first.updatesBefore - 1]!;
    const after = mover.updates[first.updatesBefore]!;
    expect(before.tick).toBeLessThan(first.message.tick);
    expect(after.tick).toBeGreaterThanOrEqual(first.message.tick);
    expect(JSON.stringify(before)).not.toContain('"MoveIntent":{"x":1');
    expect(JSON.stringify(after)).toContain('"MoveIntent":{"x":1');
    // Two moves in a row are acknowledged by their last sequence, once; a held direction sends nothing more.
    mover.room.send(WIRE.move, { x: 0, y: 1, sequence: 42 });
    mover.room.send(WIRE.move, { x: 0, y: 0, sequence: 43 });
    await waitUntil(() => mover.movesApplied.some((applied) => applied.message.sequence === 43));
    await waitForUpdates([mover, watcher], 4);
    const sequences = mover.movesApplied.map((applied) => applied.message.sequence);
    expect(sequences.at(-1)).toBe(43);
    expect(sequences.filter((sequence) => sequence === 43)).toHaveLength(1);
    expect(mover.movesApplied.map((applied) => applied.message.tick)).toEqual([...mover.movesApplied.map((applied) => applied.message.tick)].sort((a, b) => a - b));
    expect(watcher.movesApplied).toEqual([]);
    for (const player of [mover, watcher]) expect(player.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it('drops a move whose sequence is missing or is not a positive safe integer, and acknowledges none of them', async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    const sender = await join(server.port);
    await waitForUpdates([sender], 1);
    const malformed: unknown[] = [{ x: 1, y: 0 }, { x: 1, y: 0, sequence: 0 }, { x: 1, y: 0, sequence: -3 }, { x: 1, y: 0, sequence: 1.5 }, { x: 1, y: 0, sequence: '7' }, { x: 1, y: 0, sequence: 2 ** 53 }, { x: 1, y: 0, sequence: null }, { x: 1, y: 0, sequence: [1] }];
    for (const payload of malformed) sender.room.send(WIRE.move, payload);
    await waitUntil(() => server!.room.dropped.malformed === malformed.length);
    await waitForUpdates([sender], 3);
    expect(headingOf(sender.replica, sender.welcome.slot).moveIntent).toEqual({ x: 0, y: 0 });
    expect(sender.movesApplied).toEqual([]);
  });

  it(`welcomes with protocol ${WIRE_PROTOCOL} and refuses a join that names another protocol or none, without giving it a seat`, async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    const seatedPlayer = await join(server.port);
    expect(seatedPlayer.welcome.protocol).toBe(WIRE_PROTOCOL);
    const stranger = new Client(`ws://127.0.0.1:${server.port}`);
    for (const options of [undefined, {}, { protocol: WIRE_PROTOCOL - 1 }, { protocol: String(WIRE_PROTOCOL) }, { protocol: null }]) {
      const refusal = await stranger.joinById(WORLD_ROOM_ID, options).then(() => undefined, (error: unknown) => error as { code: number; message: string });
      expect(refusal?.message, JSON.stringify(options)).toContain(JOIN_REFUSAL.protocolMismatch);
    }
    expect(server.room.seatsTaken).toBe(1);
    await waitForUpdates([seatedPlayer], 2);
  });

  it('refuses the sixth player, and refuses to create or join rooms any other way', async () => {
    server = await startWorldServer({ port: 0, seed: 3 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    const sixth = new Client(`ws://127.0.0.1:${server.port}`);
    const refusal = await sixth.joinById(WORLD_ROOM_ID, LEGAL_JOIN).then(() => undefined, (error: unknown) => error as { code: number; message: string });
    expect(refusal).toBeDefined();
    expect(refusal?.code).toBe(522);
    expect(refusal?.message).toMatch(/locked/);
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
    expect(server.room.clients.length).toBe(MAX_SEATS);
    await expect(sixth.joinOrCreate('world')).rejects.toThrow(/invalid method/);
    await expect(sixth.create('world')).rejects.toThrow(/invalid method/);
    await expect(sixth.join('world')).rejects.toThrow(/invalid method/);
    await expect(sixth.reconnect('world:token')).rejects.toThrow(/invalid method/);
  });

  it('frees the seat of a player who leaves, removes their avatar for the others, and seats the next joiner there', async () => {
    server = await startWorldServer({ port: 0, seed: 4 });
    for (let seat = 0; seat < MAX_SEATS; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 1);
    const leaver = players.splice(2, 1)[0] as Player;
    const leaverEid = findPlayerEntity(players[0]!.replica, 2);
    expect(leaverEid).toBeDefined();
    await leaver.room.leave();
    await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, 2) === undefined));
    expect(server.room.seatsTaken).toBe(MAX_SEATS - 1);
    for (const player of players) expect(getRenderables(player.replica).some((renderable) => renderable.eid === leaverEid)).toBe(false);
    const next = await join(server.port);
    players.push(next);
    expect(next.welcome.slot).toBe(2);
    await waitUntil(() => players.every((player) => findPlayerEntity(player.replica, 2) !== undefined));
    expect(server.room.seatsTaken).toBe(MAX_SEATS);
  });

  it('drops oversized, unknown, slot-carrying and malformed messages while the world keeps running', async () => {
    server = await startWorldServer({ port: 0, seed: 5 });
    for (let seat = 0; seat < 3; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 2);
    const [sender, target, watcher] = players as [Player, Player, Player];
    const still = { moveIntent: { x: 0, y: 0 }, facing: { x: 0, y: 1 } };
    expect(headingOf(watcher.replica, sender.welcome.slot)).toEqual(still);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
    const tickBefore = server.room.tick;
    sender.room.send(WIRE.move, { x: 1, y: 0, sequence: 3, slot: target.welcome.slot });
    sender.room.send(WIRE.move, { x: 1, y: 0, sequence: 4, padding: 'p'.repeat(MAX_INBOUND_BYTES) });
    sender.room.send('player/teleport', { x: 0, y: 0 });
    sender.room.send('world/welcome', { slot: 1 });
    sender.room.send(WIRE.move, 'right');
    sender.room.send(WIRE.move, null);
    sender.room.send(WIRE.move, [1, 0]);
    sender.room.send(WIRE.move, { x: '1', y: 0, sequence: 5 });
    sender.room.send(WIRE.move, { x: NaN, y: 0, sequence: 6 });
    sender.room.send(WIRE.move, { x: 1, y: Infinity, sequence: 7 });
    sender.room.send(WIRE.move, { x: 1 });
    sender.room.send(WIRE.move);
    await waitForUpdates(players, 4);
    expect(server.room.dropped).toEqual({ unknownType: 2, oversized: 1, malformed: 9, overBudget: 0 });
    expect(server.room.tick).toBeGreaterThan(tickBefore + 5);
    expect(server.room.clients.length).toBe(3);
    // Neither the sender nor the player whose slot the payload named was told to move.
    expect(headingOf(watcher.replica, sender.welcome.slot)).toEqual(still);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
    // The gate is not the end of the sender's game: a well-formed move still goes through.
    sender.room.send(WIRE.move, { x: 1, y: 0, sequence: 8 });
    await waitUntil(() => headingOf(watcher.replica, sender.welcome.slot).moveIntent.x === 1);
    expect(headingOf(watcher.replica, target.welcome.slot)).toEqual(still);
  });

  it("spends a flooding player's budget instead of the sim, and disconnects a frame the transport refuses", async () => {
    server = await startWorldServer({ port: 0, seed: 6 });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    await waitForUpdates(players, 1);
    const [flooder, watcher] = players as [Player, Player];
    // Under Colyseus's own per-second ceiling, so what acts here is the room's budget, which drops instead of disconnecting.
    const flood = DISCONNECT_MESSAGES_PER_SECOND - 5;
    const tickBefore = server.room.tick;
    const floodStartedAt = performance.now();
    for (let i = 0; i < flood; i += 1) flooder.room.send(WIRE.move, { x: i % 2 === 0 ? 1 : -1, y: 0, sequence: 9 });
    await waitForUpdates(players, 3);
    // The budget refills while the flood is in flight; allow what that much time could have refilled, plus one for rounding.
    const refilled = Math.ceil(((performance.now() - floodStartedAt) / 1000) * INBOUND_MESSAGES_PER_SECOND) + 1;
    expect(server.room.dropped.overBudget).toBeGreaterThanOrEqual(flood - INBOUND_BURST - refilled);
    expect(server.room.clients.length).toBe(2);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);

    const left = new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code)));
    flooder.room.send(WIRE.move, { x: 1, y: 0, sequence: 10, padding: 'p'.repeat(MAX_FRAME_BYTES * 2) });
    expect(await left).toBe(1009);
    await waitUntil(() => findPlayerEntity(watcher.replica, flooder.welcome.slot) === undefined);
    expect(server.room.seatsTaken).toBe(1);
    expect(server.room.tick).toBeGreaterThan(tickBefore + 5);
    players.splice(players.indexOf(flooder), 1);
  });

  it('closes a session that floods unknown message types once its budget is spent, and keeps the others', async () => {
    server = await startWorldServer({ port: 0, seed: 8 });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    const [flooder, watcher] = players as [Player, Player];
    const left = new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code)));
    // Between the room's budget and Colyseus's own per-second ceiling, so only the room's guard can close the socket.
    const flood = INBOUND_BURST + 10;
    expect(flood).toBeLessThan(DISCONNECT_MESSAGES_PER_SECOND);
    for (let i = 0; i < flood; i += 1) flooder.room.send('nonsense', i);
    expect(await left).toBe(CloseCode.WITH_ERROR);
    expect(server.room.dropped.unknownType).toBeGreaterThan(INBOUND_BURST);
    expect(server.room.dropped.unknownType).toBeLessThanOrEqual(flood);
    await waitUntil(() => findPlayerEntity(watcher.replica, flooder.welcome.slot) === undefined);
    players.splice(players.indexOf(flooder), 1);
    await waitForUpdates(players, 2);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it('answers world/resync with a full state the replica applies, and gives a resync flood only its own small budget', async () => {
    server = await startWorldServer({ port: 0, seed: 7 });
    players.push(await join(server.port));
    const player = players[0] as Player;
    await waitForUpdates(players, 1);
    const fullStates = () => player.updates.filter((update) => update.kind === 'full').length;
    const before = fullStates();
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    player.room.send(WIRE.resync);
    await waitUntil(() => fullStates() > before);
    await waitForUpdates(players, 2);
    // Three requests, one state: the next send carries it, the ones after chain from it.
    expect(fullStates()).toBe(before + 1);
    expect(player.applyResults.every((result) => result === 'applied')).toBe(true);
    expect(player.replica.tick).toBe(player.updates.at(-1)?.tick);
    // A request every send for a while: the resync budget, not the move budget, bounds the full states that come back.
    const floodStartedAt = performance.now();
    for (let i = 0; i < 20; i += 1) {
      player.room.send(WIRE.resync);
      await waitForUpdates(players, 1);
    }
    const refilled = Math.ceil(((performance.now() - floodStartedAt) / 1000) * RESYNCS_PER_SECOND) + 1;
    expect(fullStates() - before).toBeLessThanOrEqual(RESYNC_BURST + refilled);
    expect(server.room.dropped.overBudget).toBeGreaterThan(10);
  });

  it(`closes a connection that never acknowledges its join after ${JOIN_ACK_TIMEOUT_MS} ms and frees the seat`, async () => {
    server = await startWorldServer({ port: 0, seed: 9 });
    players.push(await join(server.port));
    const watcher = players[0] as Player;
    const reservation = await reserveSeat(server.port);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`);
    const closed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)));
    await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
    // The seat is taken and the player spawned, but nothing is sent to a session that cannot receive yet: Colyseus
    // would hold every send in its per-client queue until the acknowledgement, so that queue must stay at the welcome alone.
    await waitUntil(() => server!.room.seatsTaken === 2 && findPlayerEntity(watcher.replica, 1) !== undefined);
    const queued = () => (server!.room.clients.find((client) => client.sessionId === reservation.sessionId) as { _enqueuedMessages?: unknown[] } | undefined)?._enqueuedMessages?.length;
    expect(queued()).toBe(1);
    await waitForUpdates(players, 10);
    expect(queued()).toBe(1);
    expect(await closed).toBe(CloseCode.WITH_ERROR);
    await waitUntil(() => server!.room.seatsTaken === 1 && findPlayerEntity(watcher.replica, 1) === undefined);
    expect(watcher.applyResults.every((result) => result === 'applied')).toBe(true);
  });

  it(`frees the seat of a session with no accepted input for ${IDLE_TIMEOUT_MS / 60000} minutes, closing it with ${IDLE_KICK.code} "${IDLE_KICK.reason}", and keeps one that plays, also while it holds one direction for several timeouts`, async () => {
    const clock = fakeClock();
    server = await startWorldServer({ port: 0, seed: 13, clock });
    for (let seat = 0; seat < 2; seat += 1) players.push(await join(server.port));
    const [idler, walker] = players as [Player, Player];
    const idlerLeft = new Promise<[number, string | undefined]>((resolve) => idler.room.onLeave((code, reason) => resolve([code, reason])));
    let walkerLeftWith: number | undefined;
    walker.room.onLeave((code) => (walkerLeftWith = code));
    await waitForUpdates(players, 1);
    // Most of the timeout passes with nobody playing: nobody is kicked yet. The minute left is slack for real time on a slow machine; the fake clock makes it free.
    clock.skip(IDLE_TIMEOUT_MS - 60_000);
    await waitForUpdates(players, 3);
    expect(server.room.clients.length).toBe(2);
    expect(server.room.idleSeatsFreed).toBe(0);
    // The walker starts walking south just before the deadline and holds the key: one move, then nothing, as a browser sends it. The idler only sends a move that fails the gate, which is not input: only the idler crosses the deadline.
    walker.room.send(WIRE.move, { x: 0, y: 1, sequence: 11 });
    idler.room.send(WIRE.move, { x: 1 });
    await waitUntil(() => headingOf(walker.replica, walker.welcome.slot).moveIntent.y === 1 && server!.room.dropped.malformed === 1);
    clock.skip(61_000);
    expect(await orTimeout(idlerLeft, 'the idler was not kicked after the timeout passed')).toEqual([IDLE_KICK.code, IDLE_KICK.reason]);
    expect(server.room.idleSeatsFreed).toBe(1);
    expect(walkerLeftWith).toBeUndefined();
    // The leave reached the sim: the idler's avatar is gone for the walker, and its seat goes to the next joiner.
    await waitUntil(() => findPlayerEntity(walker.replica, idler.welcome.slot) === undefined);
    expect(server.room.seatsTaken).toBe(1);
    players.splice(players.indexOf(idler), 1);
    const next = await join(server.port);
    players.push(next);
    expect(next.welcome.slot).toBe(idler.welcome.slot);
    expect(walker.applyResults.every((result) => result === 'applied')).toBe(true);
    // Three whole timeouts pass with the walker still holding south: walking is never idle. `next`, which never played, is kicked meanwhile (the cleanup copes: a left room's `leave` resolves at once).
    const nextLeft = new Promise<number>((resolve) => next.room.onLeave((code) => resolve(code)));
    clock.skip(3 * IDLE_TIMEOUT_MS);
    expect(await orTimeout(nextLeft, 'next was not kicked after a whole timeout without input')).toBe(IDLE_KICK.code);
    await waitForUpdates([walker], 3);
    expect(walkerLeftWith).toBeUndefined();
    expect(server.room.idleSeatsFreed).toBe(2);
    expect(headingOf(walker.replica, walker.welcome.slot).moveIntent.y).toBe(1);
    // The walker stops: its idle clock starts at that move, so most of the timeout is still ahead of it.
    walker.room.send(WIRE.move, { x: 0, y: 0, sequence: 12 });
    await waitUntil(() => headingOf(walker.replica, walker.welcome.slot).moveIntent.y === 0);
    clock.skip(IDLE_TIMEOUT_MS - 60_000);
    await waitForUpdates([walker], 3);
    expect(walkerLeftWith).toBeUndefined();
    // Past it, the walker goes.
    clock.skip(61_000);
    await waitUntil(() => walkerLeftWith !== undefined);
    expect(walkerLeftWith).toBe(IDLE_KICK.code);
    expect(server.room.idleSeatsFreed).toBe(3);
  });

});

describe('WorldRoom driven directly', () => {
  it('refuses a join without a legal character before it claims a seat, so it never holds one even for a moment', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 11 });
    try {
      for (let seat = 0; seat < MAX_SEATS - 1; seat += 1) await room.onJoin(fakeClient(`sitter-${seat}`), LEGAL_JOIN);
      await expect(room.onJoin(fakeClient('nameless'), { protocol: WIRE_PROTOCOL, character: null })).rejects.toThrow(JOIN_REFUSAL.invalidCharacter);
      // Checked before any onLeave runs for the refused client: the seat was never taken, so the last seat is still there for a legal join.
      expect(room.seatsTaken).toBe(MAX_SEATS - 1);
      expect(room.refusedJoins.invalidCharacter).toBe(1);
      await room.onJoin(fakeClient('fifth'), LEGAL_JOIN);
      expect(room.seatsTaken).toBe(MAX_SEATS);
    } finally {
      room.onDispose();
    }
  });

  it('frees the seat of a client that leaves while its join is waiting for a tick, and refuses a join when every seat is held', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 11 });
    try {
      const leaverClient = fakeClient('leaver');
      const joining = room.onJoin(leaverClient, LEGAL_JOIN);
      room.onLeave(leaverClient);
      await joining;
      expect(room.seatsTaken).toBe(0);
      // Both commands landed in the same tick, in order: the player was spawned and removed before the welcome state was taken.
      expect(leaverClient.sent.map(([type]) => type)).toEqual([WIRE.welcome]);
      const welcome = leaverClient.sent[0]?.[1] as WelcomeMessage;
      expect(welcome.state.entities.some((entity) => entity.components['Player'] !== undefined)).toBe(false);
      for (let seat = 0; seat < MAX_SEATS; seat += 1) await room.onJoin(fakeClient(`sitter-${seat}`), LEGAL_JOIN);
      expect(room.seatsTaken).toBe(MAX_SEATS);
      await expect(room.onJoin(fakeClient('sixth'), LEGAL_JOIN)).rejects.toThrow(JOIN_REFUSAL.worldFull);
    } finally {
      room.onDispose();
    }
  });

  it('frees the seat of an idle session the moment it is kicked, before its socket closes, and refuses a timeout that is not positive', async () => {
    const clock = fakeClock();
    const room = new WorldRoom();
    await room.onCreate({ seed: 14, clock, idleTimeoutMs: 1000 });
    try {
      // A peer that never answers the close handshake: its `leave` closes nothing, so `onLeave` never runs for it.
      const idler = fakeClient('idler');
      await room.onJoin(idler, LEGAL_JOIN);
      room.clients.push(idler);
      expect(room.seatsTaken).toBe(1);
      clock.skip(2000);
      await waitUntil(() => room.idleSeatsFreed === 1);
      expect(idler.left).toEqual([[IDLE_KICK.code, IDLE_KICK.reason]]);
      expect(room.seatsTaken).toBe(0);
      // The seat is already the next joiner's, and the kicked session is not kicked again while its socket lingers.
      const next = fakeClient('next');
      await room.onJoin(next, LEGAL_JOIN);
      expect((idler.sent[0]?.[1] as WelcomeMessage).slot).toBe(0);
      expect((next.sent[0]?.[1] as WelcomeMessage).slot).toBe(0);
      expect(room.idleSeatsFreed).toBe(1);
      expect(idler.left.length).toBe(1);
    } finally {
      room.onDispose();
    }
    const refused = new WorldRoom();
    await expect(refused.onCreate({ seed: 15, idleTimeoutMs: 0 })).rejects.toThrow(RangeError);
    refused.onDispose();
  });

  it('fails a join that is waiting for a tick when the room is disposed instead of hanging it', async () => {
    const room = new WorldRoom();
    await room.onCreate({ seed: 12 });
    const joining = room.onJoin(fakeClient('late'), LEGAL_JOIN);
    room.onDispose();
    await expect(joining).rejects.toThrow(/shutting down/);
  });
});

// ---- Helpers ----

/** The room on a bare port: these tests are about the room, not about what stands in front of it. */
const { startBareWorldServer: startWorldServer } = __testing__;
/** Join options the room accepts: the protocol it speaks and a legal character. */
const LEGAL_JOIN = { protocol: WIRE_PROTOCOL, character: guestCharacter(0) };

interface Player {
  readonly room: Room;
  readonly welcome: WelcomeMessage;
  readonly replica: ReplicaHandle;
  readonly updates: WorldStateUpdate[];
  readonly applyResults: WorldStateApplyResult[];
  /** Every `player/move-applied` received, with how many updates had arrived before it. */
  readonly movesApplied: Array<{ readonly message: MoveAppliedMessage; readonly updatesBefore: number }>;
}

let server: WorldServer | undefined;
const players: Player[] = [];

/**
 * Joins the world the way the browser client will and keeps a replica in step
 * with what the server sends. The update handlers are registered before the
 * welcome is awaited: a delta can arrive in the same batch as the welcome, and
 * the SDK drops a message that has no handler yet.
 */
async function join(port: number, character: Character = guestCharacter(0)): Promise<Player> {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinById(WORLD_ROOM_ID, { protocol: WIRE_PROTOCOL, character });
  const updates: WorldStateUpdate[] = [];
  const applyResults: WorldStateApplyResult[] = [];
  const bound: { replica?: ReplicaHandle } = {};
  const pending: WorldStateUpdate[] = [];
  const onUpdate = (update: WorldStateUpdate) => {
    updates.push(update);
    if (bound.replica) applyResults.push(applyWorldState(bound.replica, update));
    else pending.push(update);
  };
  room.onMessage(WIRE.delta, onUpdate);
  room.onMessage(WIRE.state, onUpdate);
  const movesApplied: Player['movesApplied'] = [];
  room.onMessage(WIRE.moveApplied, (message: MoveAppliedMessage) => movesApplied.push({ message, updatesBefore: updates.length }));
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
  if (welcome.map !== readMapTiles(worldMap).checksum) throw new Error(`the server runs another map: ${welcome.map}`);
  const replica = createReplica({ capacity: welcome.capacity });
  applyResults.push(applyWorldState(replica, welcome.state));
  for (const update of pending.splice(0)) applyResults.push(applyWorldState(replica, update));
  bound.replica = replica;
  return { room, welcome, replica, updates, applyResults, movesApplied };
}

/** A seat reservation straight from the matchmaker, for a client that will misbehave at the WebSocket stage. */
async function reserveSeat(port: number): Promise<{ sessionId: string; roomId: string; processId: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/matchmake/joinById/${WORLD_ROOM_ID}`, {
    method: 'POST',
    body: JSON.stringify(LEGAL_JOIN),
    headers: { 'content-type': 'application/json' },
  });
  return (await response.json()) as { sessionId: string; roomId: string; processId: string };
}

interface FakeClient extends ServerClient {
  readonly sent: Array<[string, unknown]>;
  /** Every `leave(code, reason)` the room asked for. Nothing closes: the fake is a peer that never answers. */
  readonly left: Array<[number | undefined, string | undefined]>;
}

/** Enough of a Colyseus client for the room's own join, kick and leave paths: a session id, a joined state, a `send` that records and a `leave` that records and closes nothing. */
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

/** `promise`, or a rejection that names what did not happen once the suite's usual wait is up. */
function orTimeout<T>(promise: Promise<T>, message: string, timeoutMs = JOIN_ACK_TIMEOUT_MS + 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** A clock a test pushes forward: real time plus whatever was skipped, so the room keeps ticking while an idle timeout passes in an instant. */
function fakeClock(): Clock & { skip(ms: number): void } {
  let skippedMs = 0;
  return {
    now: () => performance.now() + skippedMs,
    skip: (ms) => {
      skippedMs += ms;
    },
  };
}

/** Where the player in `slot` is drawn. Tests assert on what players were told (`headingOf`), not on where physics left them. */
function positionOf(replica: ReplicaHandle, slot: number): { x: number; y: number } {
  const eid = findPlayerEntity(replica, slot);
  const renderable = eid === undefined ? undefined : getRenderables(replica).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`no player in slot ${slot}`);
  return { x: renderable.x, y: renderable.y };
}

/** The character (name and look) of the player in `slot`, as a replica shows it. */
function characterInSeat(replica: ReplicaHandle, slot: number): Character | undefined {
  const eid = findPlayerEntity(replica, slot);
  return eid === undefined ? undefined : getCharacter(replica, eid);
}

/** Every player entity as drawn, one per seat taken. */
function playerRenderables(replica: ReplicaHandle): Renderable[] {
  return getRenderables(replica).filter((renderable) => isPlayerDefId(renderable.defId));
}

/** The tile a renderable's centre stands on, as one comparable string. */
function tileKeyOf(renderable: Renderable): string {
  const tile = tileAt(renderable.x, renderable.y);
  return tile ? `${tile.column},${tile.row}` : 'nowhere';
}

/** What the player in `slot` was told to do: the sim's own record of the commands that reached it. */
function headingOf(replica: ReplicaHandle, slot: number): Heading {
  const eid = findPlayerEntity(replica, slot);
  const heading = eid === undefined ? undefined : getHeading(replica, eid);
  if (!heading) throw new Error(`no player in slot ${slot}`);
  return heading;
}

/** Resolves once every player has received `count` more updates than it had. */
function waitForUpdates(waiting: readonly Player[], count: number): Promise<void> {
  const targets = waiting.map((player) => player.updates.length + count);
  return waitUntil(() => waiting.every((player, index) => player.updates.length >= (targets[index] as number)));
}

/** Polls `condition` until it holds; fails after `timeoutMs` (generous: the loop runs on real time). */
async function waitUntil(condition: () => boolean, timeoutMs = JOIN_ACK_TIMEOUT_MS + 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
