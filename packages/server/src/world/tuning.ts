import { DEFAULT_SEND_RATE, TICK_RATE } from '@novaland/sim';

/** Tuning of the world room. Game rules are not here: the sim owns those. */

/** Name the room type is registered under; what `matchMaker.createRoom` is asked for. */
export const WORLD_ROOM_NAME = 'world';
/** The one room's id, fixed so clients can join it by id without a lookup (ADR 0005). */
export const WORLD_ROOM_ID = 'world';
/** Seats in the world. The room's `maxClients`; a sixth join is refused by the matchmaker. */
export const MAX_SEATS = 5;

/** World-state updates per second each player receives. */
export const SEND_RATE = DEFAULT_SEND_RATE;
/** Whole sim ticks between two sends. */
export const TICKS_PER_SEND = Math.max(1, Math.round(TICK_RATE / SEND_RATE));
/** How often the loop wakes up to see how many ticks real time has earned. */
export const LOOP_INTERVAL_MS = Math.floor(1000 / TICK_RATE);
/** Most real time one wake-up may turn into ticks; anything beyond is dropped (a stalled process catches up, it never spirals). */
export const MAX_CATCH_UP_SECONDS = 0.25;

/** Seconds a matchmaking seat reservation holds a seat before the client connects. Reservations count against `maxClients`, so this bounds how long five bare HTTP requests can lock the world. */
export const SEAT_RESERVATION_SECONDS = 3;
/** Milliseconds after its welcome a session has to acknowledge the join; Colyseus buffers every send to it until then, so an unacknowledged session is closed instead. */
export const JOIN_ACK_TIMEOUT_MS = 5000;

/** Largest WebSocket frame the transport accepts; a bigger one closes that connection (code 1009). */
export const MAX_FRAME_BYTES = 1024;
/** Largest decoded payload the room reads; a bigger one is dropped. A `player/move` is under 60 bytes as JSON. */
export const MAX_INBOUND_BYTES = 128;
/** Largest join options the room reads, as JSON, all fields together; bigger ones refuse the join before any field is read. A character is under 300 bytes (40 code points of name and five look indexes), which leaves room for the small fields other features add. */
export const MAX_JOIN_OPTIONS_BYTES = 1024;
/** Largest `player/change-character` payload the room reads, as JSON: a character is under 300 bytes, and a name is read only up to that many again before it is normalised. */
export const MAX_CHARACTER_MESSAGE_BYTES = 512;
/** Sustained inbound messages per second a session may send; anything over its budget is dropped. */
export const INBOUND_MESSAGES_PER_SECOND = 20;
/** Messages a quiet session may send at once before the sustained rate applies. */
export const INBOUND_BURST = 40;
/** Full states per second a session may ask for with `world/resync`, and how many at once. A full state is a hundred times a delta. */
export const RESYNCS_PER_SECOND = 1;
export const RESYNC_BURST = 2;
/** Character changes per second a session may make, and how many at once. A change is sent to every player as some forty changed fields, where a move is two. */
export const CHARACTER_CHANGES_PER_SECOND = 0.5;
export const CHARACTER_CHANGE_BURST = 3;
/** Hard ceiling Colyseus enforces by disconnecting the session; a flood that ignores the budget above ends here. */
export const DISCONNECT_MESSAGES_PER_SECOND = 60;

/** Milliseconds a session may go without an accepted input before its seat is freed (#22), counted from the join or from the move that stopped the player: a player holding a direction is never idle. `IDLE_TIMEOUT_SECONDS` in the environment overrides it for one boot. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Milliseconds between two saves of where every seated player stands (#55): what a crash of the process can lose. A player who has not moved since the last save is not written again. */
export const POSITION_SAVE_INTERVAL_MS = 5000;
/** Milliseconds a player the store has never seen must hold a seat before their position is first saved. Tokens are free to mint, so this is what a new row costs: with five seats, nobody adds rows faster than five every ten seconds. A known player is saved from their first tick. */
export const NEW_PLAYER_SAVE_AFTER_MS = 10_000;
/** Most players whose position is remembered. Saving one more forgets whoever was seen longest ago. A row is under 100 bytes, so the file stays near ten megabytes; at one new row per seat every ten seconds, filling it takes one seat eleven days and all five more than two. */
export const MAX_SAVED_PLAYERS = 100_000;

/** Port when `PORT` is not set. Colyseus's conventional one. */
export const DEFAULT_PORT = 2567;
