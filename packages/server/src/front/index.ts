/**
 * The HTTP front: everything between the port and the world room. This is the
 * only file the rest of the server may import from `front/`, and nothing in
 * `front/` imports the world or Colyseus (lint enforces both). See
 * docs/decisions/0008-http-front.md.
 */
export { createFront, type Front, type FrontOptions } from './createFront';
export { readOriginPolicy, type OriginPolicy, type OriginPolicyOptions } from './origins';
