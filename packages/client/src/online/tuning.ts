import { DEFAULT_SEND_RATE, TICK_RATE } from '@novaland/sim';

/** Tuning of the client's online mode. Nothing here is a game rule: the server decides everything about the world. */

/** Id of the one world room. The server creates it with this id and only answers `joinById` (ADR 0004; `WORLD_ROOM_ID` in packages/server/src/world/tuning.ts). */
export const WORLD_ROOM_ID = 'world';
/** Seats in the world, for the `n/5 online` count: the room's `maxClients` (`MAX_SEATS` in packages/server/src/world/tuning.ts). The server, not this number, decides who gets in. */
export const WORLD_SEATS = 5;

/** Whole ticks between two server sends at the default rate. */
export const TICKS_PER_SEND = Math.max(1, Math.round(TICK_RATE / DEFAULT_SEND_RATE));
/** Send intervals the drawn frame stays behind the newest server state, so there is always a next frame to move towards. */
export const INTERPOLATION_BUFFER_SENDS = 2;
export const INTERPOLATION_BUFFER_TICKS = INTERPOLATION_BUFFER_SENDS * TICKS_PER_SEND;

/** Waits before the next attempt after a drop or an unreachable server, in order; the last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];
/** How long a client refused for a full world waits before asking for a seat again by itself. */
export const FULL_WORLD_RETRY_MS = 5000;
/** How long a joined room may take to send its welcome before the client drops it and tries again. */
export const WELCOME_TIMEOUT_MS = 10000;
