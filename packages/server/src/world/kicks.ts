/**
 * Why the room closed a session, as the WebSocket close frame carries it: the
 * code and the reason both reach the client in `room.onLeave((code, reason) =>
 * ...)`, and the Colyseus SDK does not try to reconnect on a code it does not
 * know. Codes 4000-4010 are Colyseus's own (`CloseCode`); the room's start at
 * 4100. The browser client is in another package and cannot import this file,
 * so the numbers and strings here are a contract: change one and change its
 * copy in the client with it (`IDLE_KICK_CODE` in
 * packages/client/src/online/tuning.ts) until #26 moves both into the sim's wire file.
 */

/** The seat was freed because the session sent no input for `IDLE_TIMEOUT_MS` while standing still (#22). A client that sees this shows "you were away" and rejoins only when the player asks. */
export const IDLE_KICK = { code: 4100, reason: 'idle' } as const;

/** The seat was freed because the same player joined again, from another tab or after a connection the server had not yet seen drop (#55): one player token is one player, and the newest join is the one that plays. A client that sees this shows "you are playing somewhere else" and rejoins only when the player asks, or two tabs would take the seat from each other for ever. Its copy in the client is `REPLACED_KICK_CODE`. */
export const REPLACED_KICK = { code: 4101, reason: 'joined-elsewhere' } as const;
