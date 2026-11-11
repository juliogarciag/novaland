import { DEFAULT_SEND_RATE, TICK_RATE } from '@novaland/sim';

/** Tuning of the client's online mode. Nothing here is a game rule: the server decides everything about the world. */

/** Id of the one world room. The server creates it with this id and only answers `joinById` (ADR 0005; `WORLD_ROOM_ID` in packages/server/src/world/tuning.ts). */
export const WORLD_ROOM_ID = 'world';
/** Seats in the world, for the `n/5 online` count: the room's `maxClients` (`MAX_SEATS` in packages/server/src/world/tuning.ts). The server, not this number, decides who gets in. */
export const WORLD_SEATS = 5;

/** Whole ticks between two server sends at the default rate. */
export const TICKS_PER_SEND = Math.max(1, Math.round(TICK_RATE / DEFAULT_SEND_RATE));
/** Send intervals the drawn frame stays behind the newest server state, so there is always a next frame to move towards. */
export const INTERPOLATION_BUFFER_SENDS = 2;
export const INTERPOLATION_BUFFER_TICKS = INTERPOLATION_BUFFER_SENDS * TICKS_PER_SEND;

/** Close code of a session the server freed for sending no input for its idle timeout (`IDLE_KICK` in packages/server/src/world/kicks.ts, #22). The client does not rejoin by itself after it. Duplicated like `WORLD_ROOM_ID` until #26 moves the wire values into the sim. */
export const IDLE_KICK_CODE = 4100;
/** Waits before the next attempt after a drop or an unreachable server, in order; the last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];
/** How long a client refused for a full world waits before asking for a seat again by itself. */
export const FULL_WORLD_RETRY_MS = 5000;
/** How long a join may take to settle, and then a joined room to send its welcome, before the client abandons it and tries again. */
export const JOIN_TIMEOUT_MS = 10000;
/** Out-of-sequence updates the client lets pass after asking for a full state before it asks again (the server may have dropped the request). At the default send rate this is half a second. */
export const RESYNC_RETRY_AFTER_UPDATES = 10;
/** Longest level name a welcome may carry; the name is shown on the incompatible screen when it is unknown. */
export const MAX_LEVEL_NAME_LENGTH = 64;
/** Largest seat number a welcome may carry. The sim refuses slots past its own limit; this keeps a nonsense welcome from being seated at all. */
export const MAX_SLOT = 1024;
