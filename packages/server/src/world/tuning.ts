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

/** Largest HTTP request body the server reads; a join carries `{}`. Bigger requests have their connection closed before Colyseus buffers the body. */
export const MAX_REQUEST_BODY_BYTES = 4096;
/** Largest WebSocket frame the transport accepts; a bigger one closes that connection (code 1009). */
export const MAX_FRAME_BYTES = 1024;
/** Largest decoded payload the room reads; a bigger one is dropped. A `player/move` is under 60 bytes as JSON. */
export const MAX_INBOUND_BYTES = 128;
/** Sustained inbound messages per second a session may send; anything over its budget is dropped. */
export const INBOUND_MESSAGES_PER_SECOND = 20;
/** Messages a quiet session may send at once before the sustained rate applies. */
export const INBOUND_BURST = 40;
/** Full states per second a session may ask for with `world/resync`, and how many at once. A full state is a hundred times a delta. */
export const RESYNCS_PER_SECOND = 1;
export const RESYNC_BURST = 2;
/** Hard ceiling Colyseus enforces by disconnecting the session; a flood that ignores the budget above ends here. */
export const DISCONNECT_MESSAGES_PER_SECOND = 60;

/** Milliseconds a session may go without an accepted input before its seat is freed (#22), counted from the join or from the move that stopped the player: a player holding a direction is never idle. `IDLE_TIMEOUT_SECONDS` in the environment overrides it for one boot. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Port when `PORT` is not set. Colyseus's conventional one. */
export const DEFAULT_PORT = 2567;
