import type { Server as HttpServer } from 'node:http';
import { handleRequestsFirst, handleUpgradesFirst } from './handleFirst';
import { isOriginAllowed, type OriginPolicy } from './origins';

/**
 * Refuses, with 403, every request and WebSocket upgrade whose `Origin` the
 * policy does not allow, before Colyseus sees it. That covers the matchmaking
 * calls (a seat reservation from a foreign page would otherwise hold a seat)
 * and the socket itself. Requests without an `Origin` pass: see `origins.ts`.
 * Install it after the handlers that must stay reachable from anywhere; the
 * static files and the health check are installed after this one, so they
 * run first and are never refused.
 */
export function refuseForeignOrigins(httpServer: HttpServer, policy: OriginPolicy): void {
  handleRequestsFirst(httpServer, (request, response, handOver) => {
    if (isOriginAllowed({ origin: request.headers.origin, host: request.headers.host, policy })) {
      handOver();
      return;
    }
    // The connection goes with the refusal: the body, if any, is never read, so a foreign client cannot keep the socket busy with one.
    response.writeHead(403, { 'content-type': 'application/json', 'content-length': String(FORBIDDEN_BODY.length), 'cache-control': 'no-store', connection: 'close' });
    response.end(FORBIDDEN_BODY, () => request.socket.destroy());
  });
  handleUpgradesFirst(httpServer, ({ request, socket }, handOver) => {
    if (isOriginAllowed({ origin: request.headers.origin, host: request.headers.host, policy })) {
      handOver();
      return;
    }
    socket.on('error', () => undefined);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
}

const FORBIDDEN_BODY = Buffer.from(JSON.stringify({ error: 'origin not allowed' }));
