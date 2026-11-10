/** Largest HTTP request body the edge lets through to the routes. The only body a route expects is a join, which carries `{}`. Bigger requests have their connection closed before anything buffers them. */
export const MAX_REQUEST_BODY_BYTES = 4096;

/**
 * How long a connection may go without a byte moving in either direction
 * before it is closed. A client that asks for a file and never reads it would
 * otherwise hold the connection and the open file for good. A slow download
 * keeps moving bytes and is not cut. WebSocket connections are not affected:
 * the transport takes the timeout off a socket when it upgrades it, and pings
 * it on its own.
 */
export const IDLE_CONNECTION_TIMEOUT_MS = 60_000;
