/**
 * The world: the one Colyseus room that owns the sim. This is the only file
 * the rest of the server may import from `world/`, and nothing in `world/`
 * imports the HTTP front (lint enforces both). See
 * docs/decisions/0008-http-front.md.
 */
export { startWorldServer, type RoutesApp, type WorldFront, type WorldServer, type WorldServerOptions } from './startWorldServer';
export { DEFAULT_PORT, MAX_SEATS, SEND_RATE, WORLD_ROOM_ID } from './tuning';
