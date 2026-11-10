import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { isOriginAllowed, type OriginPolicy } from './origins';

export interface RequestGuardOptions {
  readonly originPolicy: OriginPolicy;
  /** The largest request body let through, in bytes. */
  readonly maxBodyBytes: number;
}

/**
 * Stands in front of every HTTP request and refuses what must not reach the
 * routes behind it:
 *
 * - `400` for a request Colyseus cannot survive. Its router builds a URL from
 *   `X-Forwarded-Proto`, `Host` and the request target and throws outside any
 *   handler when that URL does not parse, which ends the process: one request
 *   from anyone could stop the world. So the target must be a path, `Host` a
 *   plain `host[:port]`, and `X-Forwarded-Proto`, when a proxy sends it, one
 *   of `http` and `https`.
 * - `403` for a state-changing request (anything but `GET` and `HEAD`) from a
 *   browser origin the policy does not allow. Matchmaking reserves a seat, so
 *   another site's page must not be able to call it. Files and the health
 *   check are plain reads and stay open to everyone.
 * - `413` for a body over `maxBodyBytes`. Colyseus reads the whole body of
 *   every matchmaking POST before it looks at the method, with no limit, so
 *   the body is read here first, capped, and handed on as `request.body`,
 *   which its router honours.
 *
 * A refused request is answered and its connection closed. Nothing behind the
 * guard sees it.
 *
 * This is the one place the server takes a listener off the HTTP server.
 * Colyseus has no hook in front of its own routes (it answers them before the
 * Express app it mounts), so the guard wraps the single `request` listener
 * Colyseus installs when it binds its routes, and is put in place right after
 * that. It refuses to install over any other number of listeners: a second one
 * would be wrapped without expecting a pre-read body, or bypass the guard.
 * WebSocket upgrades arrive on another event and are checked in Colyseus's
 * `beforeUpgrade` hook. New HTTP routes go in `mountEdgeRoutes`, never on
 * `httpServer.on('request')`.
 */
export function guardRequests(httpServer: HttpServer, { originPolicy, maxBodyBytes }: RequestGuardOptions): void {
  const requestListeners = httpServer.listeners('request');
  if (requestListeners.length !== 1) {
    throw new Error(`expected Colyseus's routes to be the only HTTP request listener, found ${requestListeners.length}`);
  }
  const routes = requestListeners[0] as (request: IncomingMessage, response: ServerResponse) => void;
  httpServer.removeListener('request', routes);
  httpServer.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const handOver = () => routes.call(httpServer, request, response);
    const refusal = refusalFor(request, { originPolicy, maxBodyBytes });
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
      if (receivedBytes > maxBodyBytes) {
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

/** Why the request is refused before any of its body is read, or undefined when it may go on. */
function refusalFor(request: IncomingMessage, { originPolicy, maxBodyBytes }: RequestGuardOptions): Refusal | undefined {
  if (!isWellFormed(request)) return MALFORMED_REQUEST;
  const changesState = request.method !== 'GET' && request.method !== 'HEAD';
  if (changesState && !isOriginAllowed(request.headers.origin, originPolicy)) return ORIGIN_NOT_ALLOWED;
  const declaredBytes = Number(request.headers['content-length']);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes) return BODY_TOO_LARGE;
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

function refuse(request: IncomingMessage, response: ServerResponse, { status, error }: Refusal): void {
  const body = JSON.stringify({ error });
  response.writeHead(status, { connection: 'close', 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  // A refused client may still be sending: once the answer is out, drop the connection instead of reading the rest.
  response.end(body, () => request.socket.destroy());
}
