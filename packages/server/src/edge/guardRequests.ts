import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { isOriginAllowed, type OriginPolicy } from './origins';

export interface RequestGuardOptions {
  readonly originPolicy: OriginPolicy;
  /** The largest request body let through, in bytes. */
  readonly maxRequestBodyBytes: number;
  /** How long an upgrade handed on may sit with no byte moving before its connection is closed. */
  readonly idleConnectionTimeoutMs: number;
}

/**
 * Stands in front of every HTTP request and every WebSocket upgrade and
 * refuses what must not reach what is behind it:
 *
 * - `400` for a request or an upgrade Colyseus cannot survive. Its router
 *   builds a URL from `X-Forwarded-Proto`, `Host` and the request target, and
 *   its transport builds one from the target of an upgrade; both throw outside
 *   any handler when that URL does not parse, which ends the process: one
 *   request from anyone could stop the world. So the target must be a path,
 *   `Host` a plain `host[:port]`, and `X-Forwarded-Proto`, when a proxy sends
 *   it, one of `http` and `https`.
 * - `403` for an upgrade, or a state-changing request (anything but `GET` and
 *   `HEAD`), from a browser origin the policy does not allow. The upgrade is
 *   the way into the room and matchmaking reserves a seat, so another site's
 *   page must not be able to do either. Files and the health check are plain
 *   reads and stay open to everyone. Colyseus has a `beforeUpgrade` hook for
 *   the upgrade check, but it parses the target before the hook runs, which
 *   is one of the crashes above, and it never closes a socket it refuses.
 * - `413` for a body over `maxRequestBodyBytes`. Colyseus reads the whole body
 *   of every matchmaking POST before it looks at the method, with no limit, so
 *   the body is read here first, capped, and handed on as `request.body`,
 *   which its router honours.
 * - No answer at all, only a closed connection, for a request that arrives
 *   while an answer to an earlier one on the same connection is not out yet
 *   (pipelining). Node starts such requests at once and queues their answers;
 *   if the client then hangs up, the queued answers never learn it and every
 *   file opened for them stays open for good. Browsers and proxies send one
 *   request at a time on a connection, so only a client built to exhaust the
 *   server is cut off.
 *
 * A refused request or upgrade is answered and its connection destroyed, not
 * only ended: a client that stays on, or sends more, holds nothing open.
 * Nothing behind the guard sees it. An upgrade that is handed on gets the idle
 * timeout back (Node takes it off a socket it upgrades), so one that stalls
 * in the handshake is closed too; the transport clears it for a connection it
 * accepts and pings that one itself.
 *
 * This is the one place the server takes listeners off the HTTP server.
 * Colyseus has no hook in front of its own routes (it answers them before the
 * Express app it mounts) nor in front of its upgrade handler, so the guard
 * wraps the single `request` listener and the single `upgrade` listener
 * Colyseus installs, and is put in place right after Colyseus binds its
 * routes. It refuses to install over any other number of listeners: a second
 * one would be wrapped without expecting a pre-read body, or bypass the guard.
 * New HTTP routes go in `mountEdgeRoutes`, never on `httpServer.on('request')`.
 */
export function guardRequests(httpServer: HttpServer, { originPolicy, maxRequestBodyBytes, idleConnectionTimeoutMs }: RequestGuardOptions): void {
  // Both are looked up before either is taken off, so a refusal to install leaves the server as it was.
  const routes = onlyListener(httpServer, 'request') as (request: IncomingMessage, response: ServerResponse) => void;
  const upgradeHandler = onlyListener(httpServer, 'upgrade') as (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  httpServer.removeListener('request', routes);
  httpServer.removeListener('upgrade', upgradeHandler);

  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isWellFormed(request)) {
      refuseUpgrade(socket, '400 Bad Request');
      return;
    }
    if (!isOriginAllowed(request.headers.origin, originPolicy)) {
      refuseUpgrade(socket, '403 Forbidden');
      return;
    }
    if ('setTimeout' in socket && typeof socket.setTimeout === 'function') {
      socket.setTimeout(idleConnectionTimeoutMs, () => socket.destroy());
    }
    upgradeHandler.call(httpServer, request, socket, head);
  });

  httpServer.on('request', (request: IncomingMessage, response: ServerResponse) => {
    // Node gives an answer its connection only once every answer before it is out. One without a connection is queued behind another: the client did not wait.
    if (response.socket === null) {
      request.socket.destroy();
      return;
    }
    const handOver = () => routes.call(httpServer, request, response);
    const refusal = refusalFor(request, { originPolicy, maxRequestBodyBytes });
    if (refusal !== undefined) {
      refuse(request, response, refusal);
      return;
    }
    if (!mayCarryBody(request)) {
      handOver();
      return;
    }
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let refused = false;
    request.on('error', () => undefined);
    request.on('data', (chunk: Buffer) => {
      if (refused) return;
      receivedBytes += chunk.length;
      if (receivedBytes > maxRequestBodyBytes) {
        refused = true;
        refuse(request, response, BODY_TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (refused) return;
      (request as IncomingMessage & { body?: string }).body = Buffer.concat(chunks).toString('utf8');
      handOver();
    });
  });
}

// ---- Helpers ----

interface Refusal {
  readonly status: number;
  readonly error: string;
}

const MALFORMED_REQUEST: Refusal = { status: 400, error: 'malformed request' };
const ORIGIN_NOT_ALLOWED: Refusal = { status: 403, error: 'origin not allowed' };
const BODY_TOO_LARGE: Refusal = { status: 413, error: 'request body too large' };

/** The server's one listener for `event`. Throws when there is any other number. */
function onlyListener(httpServer: HttpServer, event: 'request' | 'upgrade'): (...args: unknown[]) => void {
  const listeners = httpServer.listeners(event);
  if (listeners.length !== 1) {
    throw new Error(`expected Colyseus's handler to be the only HTTP ${event} listener, found ${listeners.length}`);
  }
  return listeners[0] as (...args: unknown[]) => void;
}

/** Why the request is refused before any of its body is read, or undefined when it may go on. */
function refusalFor(request: IncomingMessage, { originPolicy, maxRequestBodyBytes }: Pick<RequestGuardOptions, 'originPolicy' | 'maxRequestBodyBytes'>): Refusal | undefined {
  if (!isWellFormed(request)) return MALFORMED_REQUEST;
  const changesState = request.method !== 'GET' && request.method !== 'HEAD';
  if (changesState && !isOriginAllowed(request.headers.origin, originPolicy)) return ORIGIN_NOT_ALLOWED;
  const declaredBytes = Number(request.headers['content-length']);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxRequestBodyBytes) return BODY_TOO_LARGE;
  return undefined;
}

/** Whether the pieces Colyseus builds the request's URL from make a URL: a path as the target, a plain `host[:port]`, and `http` or `https` from the proxy. */
function isWellFormed(request: IncomingMessage): boolean {
  if (request.url === undefined || !request.url.startsWith('/')) return false;
  const host = request.headers.host;
  if (host !== undefined && !isHostAndPort(host)) return false;
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  return forwardedProtocol === undefined || (typeof forwardedProtocol === 'string' && /^https?$/i.test(forwardedProtocol));
}

/** `play.example.com`, `localhost:5119`, `[::1]:5119`: a host with an optional port and nothing else. */
function isHostAndPort(host: string): boolean {
  if (/[\s/\\?#@]/.test(host)) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  return url.hostname !== '' && url.pathname === '/';
}

/** A body is only read for methods that carry one and when the request announces one. */
function mayCarryBody(request: IncomingMessage): boolean {
  const method = request.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'] !== undefined;
}

/** How long a refused upgrade's answer gets to leave before its connection is destroyed anyway. */
const UPGRADE_REFUSAL_FLUSH_MS = 1000;

/** Answers an upgrade with a status and no body, then destroys the connection: once the answer is out, or after a moment if it never gets out. */
function refuseUpgrade(socket: Duplex, statusLine: string): void {
  socket.on('error', () => undefined);
  const destroyAnyway = setTimeout(() => socket.destroy(), UPGRADE_REFUSAL_FLUSH_MS);
  socket.once('close', () => clearTimeout(destroyAnyway));
  socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}

function refuse(request: IncomingMessage, response: ServerResponse, { status, error }: Refusal): void {
  const body = JSON.stringify({ error });
  response.writeHead(status, {
    connection: 'close',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  // A refused client may still be sending: once the answer is out, drop the connection instead of reading the rest.
  response.end(body, () => request.socket.destroy());
}
