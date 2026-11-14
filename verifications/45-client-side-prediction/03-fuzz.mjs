/**
 * V3: the network-facing part of this ticket, fuzzed over the wire against
 * the real room server. Two things are new at the edge: the `sequence` of a
 * `player/move` and the `protocol` join option.
 *
 * A well-behaved witness plays throughout and checks what it is told: its
 * deltas chain without a gap, and every `player/move-applied` names a move it
 * sent, in order, with a tick that never goes back and that the next update
 * has reached. Meanwhile:
 *   - joins with random options are all refused, except the exact protocol,
 *     and none of them keeps a seat;
 *   - a seated client sends random `player/move` payloads (and other types)
 *     under the room's rate ceiling: it is only ever acknowledged for
 *     payloads that are well-formed moves;
 *   - a client floods moves far over the budget and one sends raw garbage
 *     frames: the room closes or ignores them and keeps running.
 * The seed is in the report, so a failure can be replayed.
 */
import { Client } from '@colyseus/sdk';
import path from 'node:path';
import WebSocket from 'ws';
import { ROOT, check, lastLinesOf, start, summarize, waitFor, waitForPort, writeProof } from './lib.mjs';

const SERVER_PORT = 5949;
const PROTOCOL = 2;
const SEED = Number(process.env.FUZZ_SEED ?? 45);
const ENDPOINT = `ws://127.0.0.1:${SERVER_PORT}`;
const results = [];
const report = { seed: SEED };
const random = seededRandom(SEED);
/** Well-formed fuzzed moves count their sequences up from here: far from anything a random leaf can be. */
let nextFuzzSequence = 1_000_000;

const roomServer = start('pnpm', ['dev'], { cwd: path.join(ROOT, 'packages/server'), env: { PORT: String(SERVER_PORT) } });
const rooms = [];
try {
  const up = (await waitForPort(SERVER_PORT)) && (await waitFor("the room server's boot line", { read: () => roomServer.output.includes('world-room-listening'), until: Boolean }).catch(() => false));
  results.push(check('room server up, started by this run', up, up ? undefined : lastLinesOf(roomServer.output)));
  if (!up) throw new Error('nothing to fuzz');

  // ---- The witness ----
  const witness = await seat();
  const witnessLog = { updates: 0, gaps: 0, acknowledged: [], unknownSequences: 0, outOfOrder: 0, ticksBack: 0, updateBeforeTick: 0, sent: [] };
  let lastTick = witness.welcome.state.tick;
  let pendingAckTick;
  const onUpdate = (update) => {
    witnessLog.updates += 1;
    if (update.kind === 'delta' && update.fromTick !== lastTick) witnessLog.gaps += 1;
    lastTick = update.tick;
    if (pendingAckTick !== undefined && update.tick < pendingAckTick) witnessLog.updateBeforeTick += 1;
    pendingAckTick = undefined;
  };
  witness.room.onMessage('world/delta', onUpdate);
  witness.room.onMessage('world/state', onUpdate);
  witness.room.onMessage('player/move-applied', (applied) => {
    const previous = witnessLog.acknowledged.at(-1);
    if (!witnessLog.sent.includes(applied.sequence)) witnessLog.unknownSequences += 1;
    if (previous && applied.sequence <= previous.sequence) witnessLog.outOfOrder += 1;
    if (previous && applied.tick < previous.tick) witnessLog.ticksBack += 1;
    witnessLog.acknowledged.push(applied);
    pendingAckTick = applied.tick;
  });
  let witnessSequence = 0;
  const witnessWalks = setInterval(() => {
    witnessSequence += 1;
    witnessLog.sent.push(witnessSequence);
    witness.room.send('player/move', { x: witnessSequence % 2 === 0 ? 1 : -1, y: 0, sequence: witnessSequence });
  }, 250);

  // ---- Joins with random options ----
  const joinOutcomes = { refusedForProtocol: 0, refusedOtherwise: 0, seated: 0, seatedWithWrongOptions: 0 };
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const options = randomJoinOptions();
    const speaksIt = typeof options === 'object' && options !== null && !Array.isArray(options) && options.protocol === PROTOCOL;
    const outcome = await new Client(ENDPOINT).joinById('world', options).then(
      (room) => ({ room }),
      (error) => ({ error }),
    );
    if (outcome.room) {
      joinOutcomes.seated += 1;
      if (!speaksIt) joinOutcomes.seatedWithWrongOptions += 1;
      await outcome.room.leave(true).catch(() => undefined);
    } else if (String(outcome.error?.message).includes('protocol-mismatch')) joinOutcomes.refusedForProtocol += 1;
    else joinOutcomes.refusedOtherwise += 1;
  }
  report.joins = joinOutcomes;
  results.push(check('150 joins with random options: none is seated unless its protocol is exactly this one, every other one is refused as a protocol mismatch', joinOutcomes.seatedWithWrongOptions === 0 && joinOutcomes.refusedOtherwise === 0 && joinOutcomes.refusedForProtocol + joinOutcomes.seated === 150 && joinOutcomes.refusedForProtocol > 100, JSON.stringify(joinOutcomes)));
  // No refused join kept a seat: the four seats beside the witness can all still be taken.
  await new Promise((resolve) => setTimeout(resolve, 3500));
  const fillers = [];
  for (let seatNumber = 0; seatNumber < 4; seatNumber += 1) fillers.push(await seat().catch(() => undefined));
  results.push(check('after the refused joins the four other seats are all still free', fillers.every(Boolean), `${fillers.filter(Boolean).length} of 4 seated`));
  for (const filler of fillers.slice(1)) await filler?.room.leave(true).catch(() => undefined);

  // ---- A seated client sending random moves, under the rate ceiling ----
  const fuzzer = fillers[0];
  const fuzzLog = { sent: 0, wellFormedSequences: new Set(), uniqueWellFormed: [], acknowledged: [], closedWith: undefined };
  fuzzer.room.onMessage('player/move-applied', (applied) => fuzzLog.acknowledged.push(applied));
  fuzzer.room.onMessage('*', () => undefined);
  fuzzer.room.onLeave((code) => (fuzzLog.closedWith = code));
  for (let round = 0; round < 500 && fuzzLog.closedWith === undefined; round += 1) {
    const type = random() < 0.9 ? 'player/move' : pick(['player/move-applied', 'world/resync', 'player/join', 'world/welcome', '']);
    const payload = randomMovePayload();
    if (type === 'player/move' && isWellFormedMove(payload)) {
      fuzzLog.wellFormedSequences.add(payload.sequence);
      fuzzLog.lastWellFormed = payload.sequence;
      if (payload.sequence >= 1_000_000) fuzzLog.uniqueWellFormed.push(payload.sequence);
    }
    try {
      fuzzer.room.send(type, payload);
      fuzzLog.sent += 1;
    } catch {
      /* the SDK could not encode it: nothing went out */
    }
    // Under the room's sustained budget (20 a second), so nothing here is dropped for being too much.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const badAcknowledgements = fuzzLog.acknowledged.filter((applied) => !fuzzLog.wellFormedSequences.has(applied.sequence) || !Number.isSafeInteger(applied.tick) || applied.tick < 1);
  // Sent 60 ms apart and acknowledged once per send interval (50 ms), so nearly every well-formed move gets its own acknowledgement; the last one always does.
  const acknowledgedSequences = new Set(fuzzLog.acknowledged.map((applied) => applied.sequence));
  const acknowledgedShare = fuzzLog.uniqueWellFormed.filter((sequence) => acknowledgedSequences.has(sequence)).length / Math.max(1, fuzzLog.uniqueWellFormed.length);
  const lastWellFormedAcknowledged = fuzzLog.acknowledged.at(-1)?.sequence === fuzzLog.lastWellFormed;
  report.fuzzedMoves = { sent: fuzzLog.sent, wellFormed: fuzzLog.wellFormedSequences.size, acknowledged: fuzzLog.acknowledged.length, acknowledgedShare, lastWellFormedAcknowledged, badAcknowledgements, closedWith: fuzzLog.closedWith };
  results.push(check('500 random messages from a seated client: it stays seated, its well-formed moves are acknowledged (the last one always), and nothing else ever is', fuzzLog.sent >= 450 && fuzzLog.closedWith === undefined && fuzzLog.wellFormedSequences.size > 20 && acknowledgedShare > 0.7 && lastWellFormedAcknowledged && badAcknowledgements.length === 0, JSON.stringify(report.fuzzedMoves)));
  await fuzzer.room.leave(true).catch(() => undefined);

  // ---- A flood, and raw garbage ----
  const flooder = await seat();
  let flooderClosed;
  flooder.room.onLeave((code) => (flooderClosed = code));
  for (let message = 0; message < 400; message += 1) flooder.room.send('player/move', { x: 1, y: 0, sequence: message + 1 });
  await waitFor('the flooding client to be closed', { read: () => flooderClosed, until: (code) => code !== undefined, timeoutMs: 5000 }).catch(() => undefined);
  results.push(check('400 moves at once: the room closes the flooding client', flooderClosed !== undefined, `close code ${flooderClosed}`));

  // Raw sockets that acknowledge the join and then send bytes that are no message at all. The room may close each one; it must survive every one.
  let garbageFrames = 0;
  let garbageSockets = 0;
  for (let socketNumber = 0; socketNumber < 12; socketNumber += 1) {
    const reservation = await fetch(`http://127.0.0.1:${SERVER_PORT}/matchmake/joinById/world`, { method: 'POST', body: JSON.stringify({ protocol: PROTOCOL }), headers: { 'content-type': 'application/json' } }).then((response) => response.json());
    if (!reservation.sessionId) continue;
    const raw = new WebSocket(`${ENDPOINT}/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`);
    const opened = await new Promise((resolve) => {
      raw.once('open', () => resolve(true));
      raw.once('error', () => resolve(false));
    });
    if (!opened) continue;
    garbageSockets += 1;
    // Colyseus's own join acknowledgement (Protocol.JOIN_ROOM), so what follows is read as a seated client's messages.
    raw.send(Buffer.from([10]));
    for (let frame = 0; frame < 20 && raw.readyState === WebSocket.OPEN; frame += 1) {
      const bytes = Buffer.alloc(1 + Math.floor(random() * 60));
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(random() * 256);
      // Mostly frames that claim to be room messages, so they reach the message decoder.
      if (random() < 0.7) bytes[0] = 13;
      raw.send(bytes);
      garbageFrames += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    raw.terminate();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  report.garbage = { sockets: garbageSockets, frames: garbageFrames };

  // ---- What the witness saw through all of it ----
  await new Promise((resolve) => setTimeout(resolve, 1000));
  clearInterval(witnessWalks);
  await new Promise((resolve) => setTimeout(resolve, 500));
  report.witness = { ...witnessLog, acknowledged: witnessLog.acknowledged.length, sent: witnessLog.sent.length };
  results.push(check('the witness kept playing through all of it: its deltas chain without a gap', witnessLog.updates > 600 && witnessLog.gaps === 0, `${witnessLog.updates} updates, ${witnessLog.gaps} gaps`));
  results.push(check('every acknowledgement the witness got names a move it sent, in order, with a tick that never goes back and that the next update has reached', witnessLog.acknowledged.length > 0.8 * witnessLog.sent.length && witnessLog.unknownSequences === 0 && witnessLog.outOfOrder === 0 && witnessLog.ticksBack === 0 && witnessLog.updateBeforeTick === 0, JSON.stringify(report.witness)));
  const stillSeats = await seat().then((player) => player.room.leave(true).then(() => true), () => false);
  results.push(check(`after ${garbageFrames} garbage frames from ${garbageSockets} joined sockets the room is alive, has not crashed and still seats a player`, garbageSockets >= 8 && garbageFrames >= garbageSockets && stillSeats && !roomServer.output.includes('world-room-crashed'), lastLinesOf(roomServer.output).slice(0, 200)));
} catch (error) {
  results.push(check(`run completed (${error.message})`, false));
} finally {
  for (const room of rooms) await room.leave(true).catch(() => undefined);
  roomServer.stop();
}

report.results = results;
writeProof('03-fuzz.json', report);
process.exit(summarize(results) ? 0 : 1);

// ---- Helpers ----

/** Joins the way the browser does and resolves once welcomed. */
async function seat() {
  const room = await new Client(ENDPOINT).joinById('world', { protocol: PROTOCOL });
  room.reconnection.enabled = false;
  rooms.push(room);
  room.onMessage('world/delta', () => undefined);
  room.onMessage('world/state', () => undefined);
  room.onMessage('player/move-applied', () => undefined);
  const welcome = await new Promise((resolve) => room.onMessage('world/welcome', resolve));
  return { room, welcome };
}

/** What the room's edge gate accepts: exactly { x, y, sequence }, finite x and y, a positive safe-integer sequence. */
function isWellFormedMove(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  return keys.join() === 'sequence,x,y' && Number.isFinite(payload.x) && Number.isFinite(payload.y) && typeof payload.x === 'number' && typeof payload.y === 'number' && Number.isSafeInteger(payload.sequence) && payload.sequence >= 1;
}

function pick(items) {
  return items[Math.floor(random() * items.length)];
}

function randomLeaf() {
  return pick([0, 1, -1, 0.5, 2, 7, 1e308, -0, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_SAFE_INTEGER, Math.floor(random() * 1e6), -Math.floor(random() * 1e6), random(), '1', '', 'x', null, undefined, true, false, [], [1], {}]);
}

/** Mostly objects with the move's own fields, so many payloads land on or next to the valid shape. */
function randomMovePayload() {
  const roll = random();
  if (roll < 0.1) return randomLeaf();
  const payload = {};
  const keys = roll < 0.8 ? ['x', 'y', 'sequence'] : Array.from({ length: Math.floor(random() * 5) }, () => pick(['x', 'y', 'sequence', 'slot', 'type', 'tick']));
  for (const key of keys) {
    // Counted up from a million and never repeated, so an acknowledgement of one of these names exactly one payload. (A leaf can still be a small valid sequence; those may repeat.)
    if (key === 'sequence' && random() < 0.6) payload[key] = (nextFuzzSequence += 1 + Math.floor(random() * 1000));
    else if ((key === 'x' || key === 'y') && random() < 0.7) payload[key] = Math.round((random() * 2 - 1) * 100) / 100;
    else payload[key] = randomLeaf();
  }
  if (random() < 0.1) payload.padding = 'p'.repeat(Math.floor(random() * 300));
  return payload;
}

function randomJoinOptions() {
  const roll = random();
  if (roll < 0.05) return { protocol: PROTOCOL };
  if (roll < 0.1) return undefined;
  if (roll < 0.2) return {};
  if (roll < 0.6) return { protocol: pick([0, 1, 3, -2, 2.5, '2', 'two', null, true, [2], { value: 2 }, 2 ** 31, NaN]) };
  return { [pick(['Protocol', 'version', 'proto', 'slot'])]: PROTOCOL, extra: randomLeaf() };
}

/** A small deterministic generator (mulberry32). */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
