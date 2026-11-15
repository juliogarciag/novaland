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
/** Close code of a session the server closed because the same player token joined again, from another tab or window (`REPLACED_KICK` in packages/server/src/world/kicks.ts, #55). The client does not rejoin by itself after it. Duplicated like `IDLE_KICK_CODE`. */
export const REPLACED_KICK_CODE = 4101;
/** Waits before the next attempt after a drop or an unreachable server, in order; the last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];
/** How long a client refused for a full world waits before asking for a seat again by itself. */
export const FULL_WORLD_RETRY_MS = 5000;
/** How long a join may take to settle, and then a joined room to send its welcome, before the client abandons it and tries again. */
export const JOIN_TIMEOUT_MS = 10000;
/** How often a seated client pings the server to measure the round trip the HUD shows. One byte each way; far below the server's message limit. */
export const LATENCY_INTERVAL_MS = 1000;
/** Out-of-sequence updates the client lets pass after asking for a full state before it asks again (the server may have dropped the request). At the default send rate this is half a second. */
export const RESYNC_RETRY_AFTER_UPDATES = 10;
/** Longest map checksum a welcome may carry. The sim's is 8 characters; this only keeps a nonsense welcome from being read at all. */
export const MAX_MAP_CHECKSUM_LENGTH = 64;
/** Largest seat number a welcome may carry. The sim refuses slots past its own limit; this keeps a nonsense welcome from being seated at all. */
export const MAX_SLOT = 1024;

/** Most ticks the local player is predicted ahead of the newest server state, and how long a move the server has not acknowledged is replayed before it is given up (ADR 0012): one second. Past it the client shows what the server says. */
export const MAX_PREDICTION_TICKS = TICK_RATE;
/** Most ticks one frame steps the prediction one by one; a longer gap (a tab that was hidden) is rebuilt from the server state instead. */
export const MAX_LIVE_PREDICTION_TICKS = TICK_RATE / 4;
/** A correction (what a reconciliation changed in the predicted position) is not shown as a jump: it is added to the drawn position and halves every this many seconds. */
export const CORRECTION_HALF_LIFE_SECONDS = 0.04;
/** A correction longer than this is a teleport, not a misprediction: it is shown at once. Longer than a player walks in the second a guess may last, so giving up a move the server never applied still fades. */
export const SNAP_DISTANCE_METRES = 8;
/** A correction shorter than this is dropped: nobody sees a tenth of a millimetre. */
export const NEGLIGIBLE_CORRECTION_METRES = 1e-4;
