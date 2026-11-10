/**
 * The HTTP edge: everything between the port and the world room. This is the
 * only file the rest of the server may import from `edge/`, and nothing in
 * `edge/` imports the world or Colyseus (lint enforces both). See
 * docs/decisions/0008-http-edge.md.
 */
export { createEdge, type Edge, type EdgeOptions } from './createEdge';
export { readOriginPolicy, type OriginPolicy, type OriginPolicyOptions } from './origins';
