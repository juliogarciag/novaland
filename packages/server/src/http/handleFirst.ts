import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/** Answers a request, or calls `handOver` so the handlers installed before it see the request untouched. */
export type FirstRequestHandler = (request: IncomingMessage, response: ServerResponse, handOver: () => void) => void;
/** Answers an upgrade (writing to the raw socket), or calls `handOver` so the handlers installed before it see it untouched. */
export type FirstUpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer, handOver: () => void) => void;

/**
 * Puts `handler` in front of every `request` listener the server has now.
 * Node calls every listener of an event, so a plain `on('request')` next to
 * Colyseus's router would answer the same request twice; instead the existing
 * listeners are taken off and only run when the handler hands over. Installed
 * after `listen`, which is when Colyseus binds its routes.
 */
export function handleRequestsFirst(httpServer: HttpServer, handler: FirstRequestHandler): void {
  const previous = httpServer.listeners('request') as Array<(request: IncomingMessage, response: ServerResponse) => void>;
  httpServer.removeAllListeners('request');
  httpServer.on('request', (request: IncomingMessage, response: ServerResponse) => {
    handler(request, response, () => {
      for (const listener of previous) listener.call(httpServer, request, response);
    });
  });
}

/** The same, for WebSocket upgrades: the transport's listener only runs when the handler hands over. */
export function handleUpgradesFirst(httpServer: HttpServer, handler: FirstUpgradeHandler): void {
  const previous = httpServer.listeners('upgrade') as Array<(request: IncomingMessage, socket: Duplex, head: Buffer) => void>;
  httpServer.removeAllListeners('upgrade');
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    handler(request, socket, head, () => {
      for (const listener of previous) listener.call(httpServer, request, socket, head);
    });
  });
}
