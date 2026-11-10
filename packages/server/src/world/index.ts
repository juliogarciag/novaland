/**
 * The world: the one Colyseus room that owns the sim. This is the only file
 * the rest of the server may import from `world/`, and nothing in `world/`
 * imports the HTTP edge (lint enforces both). See
 * docs/decisions/0008-http-edge.md.
 */
export { startWorldServer, type WorldFront, type WorldServer, type WorldServerOptions } from './startWorldServer';
export { DEFAULT_PORT, MAX_REQUEST_BODY_BYTES, MAX_SEATS, SEND_RATE, WORLD_ROOM_ID } from './tuning';
