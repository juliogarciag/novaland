import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { guardRequests } from './guardRequests';
import { readOriginPolicy } from './origins';

describe('guardRequests', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((httpServer) => new Promise((resolve) => httpServer.close(resolve))));
  });

  it("wraps the server's one request listener and its one upgrade listener in place of them", () => {
    const httpServer = createServer();
    const routes = () => undefined;
    const upgradeHandler = () => undefined;
    httpServer.on('request', routes);
    httpServer.on('upgrade', upgradeHandler);
    guardRequests(httpServer, GUARD);
    expect(httpServer.listeners('request')).toHaveLength(1);
    expect(httpServer.listeners('request')[0]).not.toBe(routes);
    expect(httpServer.listeners('upgrade')).toHaveLength(1);
    expect(httpServer.listeners('upgrade')[0]).not.toBe(upgradeHandler);
  });

  it('refuses to install unless exactly one listener handles requests and exactly one handles upgrades, and leaves the server as it was', () => {
    const none = createServer();
    none.on('upgrade', () => undefined);
    expect(() => guardRequests(none, GUARD)).toThrow(/only HTTP request listener, found 0/);

    const two = createServer();
    two.on('request', () => undefined);
    two.on('request', () => undefined);
    two.on('upgrade', () => undefined);
    expect(() => guardRequests(two, GUARD)).toThrow(/only HTTP request listener, found 2/);
    expect(two.listeners('request')).toHaveLength(2);

    const noUpgrade = createServer();
    const routes = () => undefined;
    noUpgrade.on('request', routes);
    expect(() => guardRequests(noUpgrade, GUARD)).toThrow(/only HTTP upgrade listener, found 0/);
    expect(noUpgrade.listeners('request')).toEqual([routes]);
  });

  it('hands a request with a body to the routes with the whole body already read', async () => {
    const { url, seenRequests } = await guardedServer();
    const response = await fetch(url, { method: 'POST', body: '{"hello":1}' });
    expect(response.status).toBe(200);
    expect(seenRequests).toEqual([{ method: 'POST', url: '/', body: '{"hello":1}' }]);
  });

  it('hands a request without a body straight to the routes', async () => {
    const { url, seenRequests } = await guardedServer();
    await fetch(`${url}some/file.js`);
    await fetch(url, { method: 'OPTIONS' });
    expect(seenRequests).toEqual([
      { method: 'GET', url: '/some/file.js', body: undefined },
      { method: 'OPTIONS', url: '/', body: undefined },
    ]);
  });

  it('answers 413 to a body over the cap and 403 to a state-changing request from a foreign origin, and the routes never see either', async () => {
    const { url, seenRequests } = await guardedServer();
    const tooLarge = await fetch(url, { method: 'POST', body: 'x'.repeat(GUARD.maxRequestBodyBytes + 1) }).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(tooLarge);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const foreign = await fetch(url, { method, headers: { origin: 'https://evil.example.com' } });
      expect(foreign.status, method).toBe(403);
      expect(foreign.headers.get('x-content-type-options'), method).toBe('nosniff');
      expect(await foreign.json(), method).toEqual({ error: 'origin not allowed' });
    }
    expect(seenRequests).toEqual([]);
  });

  it('lets a read from a foreign origin, and a state-changing request from the listed origin or from no browser, reach the routes', async () => {
    const { url, seenRequests } = await guardedServer();
    await fetch(url, { headers: { origin: 'https://evil.example.com' } });
    await fetch(url, { method: 'HEAD', headers: { origin: 'https://evil.example.com' } });
    await fetch(url, { method: 'POST', headers: { origin: 'https://play.example.com' } });
    await fetch(url, { method: 'POST' });
    expect(seenRequests.map((request) => request.method)).toEqual(['GET', 'HEAD', 'POST', 'POST']);
  });

  it('takes a forwarded protocol in either case, as a proxy may spell it', async () => {
    const { url, seenRequests } = await guardedServer();
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'HTTPS' } })).status).toBe(200);
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'http' } })).status).toBe(200);
    expect((await fetch(url, { headers: { 'x-forwarded-proto': 'ftp' } })).status).toBe(400);
    expect(seenRequests).toHaveLength(2);
  });

  it('answers 400 to an upgrade whose target is not a path or whose Host is no host, and hands a well-formed one to the upgrade handler', async () => {
    const { port, seenUpgrades } = await guardedServer();
    const upgrade = (target: string, host = `localhost:${port}`) => [`GET ${target} HTTP/1.1`, `Host: ${host}`, 'Connection: Upgrade', 'Upgrade: websocket'];
    for (const target of ['*:99999999', '*%', '*[', '*:abc']) {
      expect(await statusLine(port, upgrade(target)), target).toBe('HTTP/1.1 400 Bad Request');
    }
    expect(await statusLine(port, upgrade('/world', 'a:b'))).toBe('HTTP/1.1 400 Bad Request');
    expect(seenUpgrades).toEqual([]);
    expect(await statusLine(port, upgrade('/world?sessionId=1'))).toBe('HTTP/1.1 101 Switching Protocols');
    expect(seenUpgrades).toEqual(['/world?sessionId=1']);
  });

  it('closes a connection that sends a second request before the first is answered, and the routes never see the second', async () => {
    const { port, seenRequests, answerHeldRequests } = await guardedServer({ holdAnswers: true });
    const closed = new Promise<string>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write('GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\n\r\n'));
      let received = '';
      socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(received));
    });
    expect(await closed).toBe('');
    expect(seenRequests.map((request) => request.url)).toEqual(['/first']);
    answerHeldRequests();
  });

  it('serves one request after another on a kept-alive connection', async () => {
    const { port, seenRequests } = await guardedServer();
    const answers = await new Promise<string>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write('GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n'));
      let received = '';
      let sentSecond = false;
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('latin1');
        if (!sentSecond && received.endsWith('ok')) {
          sentSecond = true;
          socket.write('GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
        }
      });
      socket.on('close', () => resolve(received));
    });
    expect(answers.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(2);
    expect(seenRequests.map((request) => request.url)).toEqual(['/first', '/second']);
  });
});

// ---- Helpers ----

const GUARD = { originPolicy: readOriginPolicy({ allowedOrigins: 'https://play.example.com', allowLoopback: false }), maxRequestBodyBytes: 64 };
const servers: HttpServer[] = [];

interface SeenRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly body: string | undefined;
}

interface GuardedServer {
  readonly url: string;
  readonly port: number;
  /** What reached the routes behind the guard. */
  readonly seenRequests: SeenRequest[];
  /** The targets of the upgrades that reached the upgrade handler behind the guard. */
  readonly seenUpgrades: string[];
  /** Answers the requests the routes are holding, when they were asked to hold them. */
  readonly answerHeldRequests: () => void;
}

/** A listening server whose routes record what reaches them and answer 200 (at once, or when told to with `holdAnswers`) and whose upgrade handler records and answers 101, with the guard in front. */
async function guardedServer({ holdAnswers = false } = {}): Promise<GuardedServer> {
  const seenRequests: SeenRequest[] = [];
  const seenUpgrades: string[] = [];
  const heldResponses: ServerResponse[] = [];
  const httpServer = createServer((request: IncomingMessage & { body?: string }, response) => {
    seenRequests.push({ method: request.method, url: request.url, body: request.body });
    if (holdAnswers) heldResponses.push(response);
    else response.end('ok');
  });
  httpServer.on('upgrade', (request, socket) => {
    seenUpgrades.push(request.url ?? '');
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n');
  });
  guardRequests(httpServer, GUARD);
  servers.push(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, port, seenRequests, seenUpgrades, answerHeldRequests: () => heldResponses.splice(0).forEach((response) => response.end('ok')) };
}

/** Writes the request lines to a bare socket and returns the status line of the answer (or says there was none). */
function statusLine(port: number, lines: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';
    const answer = () => received.split('\r\n')[0] || 'no answer';
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(answer());
    });
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('latin1');
      if (received.includes('\r\n')) {
        socket.destroy();
        resolve(answer());
      }
    });
    socket.on('error', () => resolve(answer()));
    socket.on('close', () => resolve(answer()));
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  });
}
