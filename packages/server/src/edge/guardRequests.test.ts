import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { guardRequests } from './guardRequests';
import { readOriginPolicy } from './origins';

describe('guardRequests', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((httpServer) => new Promise((resolve) => httpServer.close(resolve))));
  });

  it("wraps the server's one request listener in place of it", () => {
    const httpServer = createServer();
    const routes = () => undefined;
    httpServer.on('request', routes);
    guardRequests(httpServer, GUARD);
    expect(httpServer.listeners('request')).toHaveLength(1);
    expect(httpServer.listeners('request')[0]).not.toBe(routes);
  });

  it('refuses to install when the server has no request listener', () => {
    expect(() => guardRequests(createServer(), GUARD)).toThrow(/found 0/);
  });

  it('refuses to install when something besides the routes listens for requests', () => {
    const httpServer = createServer();
    httpServer.on('request', () => undefined);
    httpServer.on('request', () => undefined);
    expect(() => guardRequests(httpServer, GUARD)).toThrow(/found 2/);
    expect(httpServer.listeners('request')).toHaveLength(2);
  });

  it('hands a request with a body to the routes with the whole body already read', async () => {
    const { url, seen } = await guardedServer();
    const response = await fetch(url, { method: 'POST', body: '{"hello":1}' });
    expect(response.status).toBe(200);
    expect(seen).toEqual([{ method: 'POST', url: '/', body: '{"hello":1}' }]);
  });

  it('hands a request without a body straight to the routes', async () => {
    const { url, seen } = await guardedServer();
    await fetch(`${url}some/file.js`);
    await fetch(url, { method: 'OPTIONS' });
    expect(seen).toEqual([
      { method: 'GET', url: '/some/file.js', body: undefined },
      { method: 'OPTIONS', url: '/', body: undefined },
    ]);
  });

  it('answers 413 to a body over the cap and 403 to a state-changing request from a foreign origin, and the routes never see either', async () => {
    const { url, seen } = await guardedServer();
    const tooLarge = await fetch(url, { method: 'POST', body: 'x'.repeat(GUARD.maxBodyBytes + 1) }).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(tooLarge);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const foreign = await fetch(url, { method, headers: { origin: 'https://evil.example.com' } });
      expect(foreign.status, method).toBe(403);
      expect(await foreign.json(), method).toEqual({ error: 'origin not allowed' });
    }
    expect(seen).toEqual([]);
  });

  it('lets a read from a foreign origin, and a state-changing request from the listed origin or from no browser, reach the routes', async () => {
    const { url, seen } = await guardedServer();
    await fetch(url, { headers: { origin: 'https://evil.example.com' } });
    await fetch(url, { method: 'HEAD', headers: { origin: 'https://evil.example.com' } });
    await fetch(url, { method: 'POST', headers: { origin: 'https://play.example.com' } });
    await fetch(url, { method: 'POST' });
    expect(seen.map((request) => request.method)).toEqual(['GET', 'HEAD', 'POST', 'POST']);
  });

  it('takes a forwarded protocol in either case, as a proxy may spell it', async () => {
    const { url, seen } = await guardedServer();
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'HTTPS' } })).status).toBe(200);
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'http' } })).status).toBe(200);
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'ftp' } })).status).toBe(400);
    expect(seen).toHaveLength(2);
  });
});

// ---- Helpers ----

const GUARD = { originPolicy: readOriginPolicy({ allowedOrigins: 'https://play.example.com', allowLoopback: false }), maxBodyBytes: 64 };
const servers: HttpServer[] = [];

interface SeenRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly body: string | undefined;
}

/** A listening server whose only routes record what reaches them and answer 200, with the guard in front. */
async function guardedServer(): Promise<{ url: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const httpServer = createServer((request: IncomingMessage & { body?: string }, response) => {
    seen.push({ method: request.method, url: request.url, body: request.body });
    response.end('ok');
  });
  guardRequests(httpServer, GUARD);
  servers.push(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`, seen };
}
