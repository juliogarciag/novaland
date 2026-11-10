import express from 'express';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEdge } from './createEdge';
import { readOriginPolicy } from './origins';

describe('createEdge', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((httpServer) => new Promise((resolve) => httpServer.close(resolve))));
  });

  it('refuses an upgrade from an origin the policy does not allow, and lets a listed origin and a client that is no browser through', () => {
    const edge = createEdge(OPTIONS);
    expect(edge.upgradeRefusal(new Headers({ origin: 'https://evil.example.com' }))?.status).toBe(403);
    expect(edge.upgradeRefusal(new Headers({ origin: 'https://play.example.com' }))).toBeUndefined();
    expect(edge.upgradeRefusal(new Headers())).toBeUndefined();
  });

  it('names the caller in the matchmaking headers only when the policy allows it, and always sends nosniff and Vary', () => {
    const edge = createEdge(OPTIONS);
    expect(edge.matchmakingHeaders(new Headers({ origin: 'https://play.example.com' }))).toEqual({ 'Access-Control-Allow-Origin': 'https://play.example.com', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    expect(edge.matchmakingHeaders(new Headers({ origin: 'https://evil.example.com' }))).toEqual({ 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    // Another spelling of the listed origin is refused, so nothing a browser would not match is ever sent back.
    expect(edge.matchmakingHeaders(new Headers({ origin: 'https://play.example.com/x' }))).toEqual({ 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    expect(edge.matchmakingHeaders(new Headers())).toEqual({ 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  });

  it('closes a connection on which no byte moves: a client that asks for a large file and never reads it does not hold it open', async () => {
    const clientDirectory = await mkdtemp(path.join(tmpdir(), 'novaland-edge-'));
    await writeFile(path.join(clientDirectory, 'big.bin'), Buffer.alloc(64 * 1024 * 1024));
    const edge = createEdge({ ...OPTIONS, clientDirectory, idleConnectionTimeoutMs: 300 });
    const app = express();
    edge.mountRoutes(app);
    edge.httpServer.on('request', app);
    servers.push(edge.httpServer);
    await new Promise<void>((resolve) => edge.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = edge.httpServer.address() as AddressInfo;

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write('GET /big.bin HTTP/1.1\r\nHost: localhost\r\nAccept-Encoding: identity\r\n\r\n');
        // Never read: the kernel's buffers fill and the server can send no more.
        socket.pause();
      });
      socket.on('error', () => resolve());
      socket.on('close', () => resolve());
      // A paused socket does not notice the other side closing, so look again once the timeout has had time to fire.
      setTimeout(() => socket.resume(), 1500);
    });
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(await new Promise<number>((resolve) => edge.httpServer.getConnections((_error, count) => resolve(count)))).toBe(0);
  });
});

// ---- Helpers ----

const OPTIONS = { originPolicy: readOriginPolicy({ allowedOrigins: 'https://play.example.com', allowLoopback: false }), clientDirectory: undefined, health: () => ({}) };
const servers: HttpServer[] = [];
