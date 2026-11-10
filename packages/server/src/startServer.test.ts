import { Client } from '@colyseus/sdk';
import { WIRE, type WelcomeMessage } from '@novaland/sim';
import { readdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readOriginPolicy } from './edge';
import { startServer } from './startServer';
import { MAX_SEATS, WORLD_ROOM_ID, type WorldServer } from './world';

describe('one process: the client files, /healthz and the request guard in front of the world room', () => {
  beforeAll(async () => {
    server = await startServer({ port: 0, seed: 7, originPolicy: readOriginPolicy({ allowedOrigins: 'https://tunnel.example.com', allowLoopback: true }), clientDirectory: await fakeClientBuild() });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves index.html at / with the security headers and no long cache', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0');
    expect(response.headers.get('etag')).toMatch(/^W\/"/);
    expect(response.headers.get('x-powered-by')).toBeNull();
    // Whether the site is HTTPS-only is the host's call, not this process's.
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(await response.text()).toContain('<title>Novaland</title>');
  });

  it('serves the hashed assets as immutable with their content type, and the sprites under /sprites', async () => {
    const script = await fetch(`${baseUrl}/assets/index-abc123.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await script.text()).toBe('console.log("bundle")');
    const sprite = await fetch(`${baseUrl}/sprites/player.png`);
    expect(sprite.status).toBe(200);
    expect(sprite.headers.get('content-type')).toBe('image/png');
    expect(sprite.headers.get('cache-control')).toBe('public, max-age=0');
    expect((await sprite.arrayBuffer()).byteLength).toBe(PNG_HEADER.length);
  });

  it('answers 304 to a matching ETag, headers only to HEAD and a part of the file to a range request', async () => {
    const first = await fetch(`${baseUrl}/`);
    // Sent without `fetch`, which adds `Cache-Control: no-cache` to a conditional request and so asks for a fresh copy.
    const again = await rawGet(server.port, '/', { 'if-none-match': first.headers.get('etag') ?? '' });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');
    const head = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(first.headers.get('content-length'));
    expect(await head.text()).toBe('');
    const part = await fetch(`${baseUrl}/assets/index-abc123.js`, { headers: { range: 'bytes=0-6' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('console');
  });

  it('compresses a large file for a browser that accepts it', async () => {
    const compressed = await fetch(`${baseUrl}/assets/big-abc123.js`);
    expect(['gzip', 'br', 'deflate']).toContain(compressed.headers.get('content-encoding'));
    expect((await compressed.arrayBuffer()).byteLength).toBe(BIG_ASSET_BYTES);
    const plain = await fetch(`${baseUrl}/assets/big-abc123.js`, { headers: { 'accept-encoding': 'identity' } });
    expect(plain.headers.get('content-encoding')).toBeNull();
    // A part of the file is a part of the plain file: it goes out as it is, even to a browser that accepts compression.
    const part = await rawGet(server.port, '/assets/big-abc123.js', { range: 'bytes=0-9', 'accept-encoding': 'gzip' });
    expect(part.status).toBe(206);
    expect(part.body).toBe('//////////');
  });

  it('answers a range that cannot be satisfied, a failed precondition and a directory without a slash with their status, and logs nothing for them', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await rawGet(server.port, '/assets/index-abc123.js', { range: 'bytes=5-2' })).status).toBe(416);
      expect((await rawGet(server.port, '/assets/index-abc123.js', { range: 'bytes=999999-' })).status).toBe(416);
      expect((await rawGet(server.port, '/assets/index-abc123.js', { 'if-match': '"nope"' })).status).toBe(412);
      // No redirect to the directory with a slash: there is no directory to browse.
      expect((await rawGet(server.port, '/assets')).status).toBe(404);
      expect((await rawGet(server.port, '/sprites')).status).toBe(404);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('never serves a file outside the client directory, a dotfile or a directory listing', async () => {
    for (const url of ['/../secret.txt', '/assets/..%2f..%2fsecret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/.hidden', '/assets/.hidden', '/%00', '/assets/']) {
      const { status, body } = await rawGet(server.port, url);
      expect(status, url).not.toBe(200);
      expect(body, url).not.toContain(SECRET_CONTENT);
      expect(body, url).not.toContain(HIDDEN_CONTENT);
    }
  });

  it('answers 404 to an unknown path and to another method on a file', async () => {
    expect((await fetch(`${baseUrl}/missing.js`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/`, { method: 'POST' })).status).toBe(404);
  });

  it('closes the file when the browser gives up mid-download: no descriptor is left open', async () => {
    await abortDownload(server.port, '/assets/big-abc123.js'); // warm up, so the baseline holds no keep-alive socket about to close
    const before = await descriptorCountOnceSettled(openDescriptorCount());
    for (let attempt = 0; attempt < 5; attempt += 1) await abortDownload(server.port, '/assets/big-abc123.js');
    expect(await descriptorCountOnceSettled(before)).toBeLessThanOrEqual(before);
    expect((await fetch(`${baseUrl}/assets/index-abc123.js`)).status).toBe(200);
  });

  it('drops a connection that sends its next request before the last answer is out, so a burst that hangs up leaves no file open', async () => {
    const before = await descriptorCountOnceSettled(openDescriptorCount());
    for (let round = 0; round < 3; round += 1) await sendBurstAndHangUp(server.port, { url: '/assets/big-abc123.js', requests: 200 });
    expect(await descriptorCountOnceSettled(before)).toBeLessThanOrEqual(before);
    // One request at a time on a kept-alive connection, as browsers and proxies send them, still works.
    expect(await sequentialStatuses(server.port, ['/assets/index-abc123.js', '/healthz', '/'])).toEqual([200, 200, 200]);
  });

  it('answers /healthz with the room in it', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, roomId: 'world', seats: MAX_SEATS, seatsTaken: 0, tick: expect.any(Number) });
  });

  it('refuses a matchmaking call from a foreign origin with 403, before Colyseus, and lets listed and loopback origins through', async () => {
    const url = `${baseUrl}/matchmake/joinById/world`;
    for (const method of ['OPTIONS', 'POST']) {
      const foreign = await fetch(url, { method, headers: { origin: 'https://evil.example.com' } });
      expect(foreign.status, method).toBe(403);
      expect(foreign.headers.get('access-control-allow-origin'), method).toBeNull();
      expect(foreign.headers.get('connection'), method).toBe('close');
      expect(await foreign.json(), method).toEqual({ error: 'origin not allowed' });
    }
    const listed = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://tunnel.example.com' } });
    expect(listed.status).toBe(204);
    expect(listed.headers.get('access-control-allow-origin')).toBe('https://tunnel.example.com');
    const loopbackDevServer = await fetch(url, { method: 'OPTIONS', headers: { origin: 'http://localhost:5218' } });
    expect(loopbackDevServer.status).toBe(204);
    expect(loopbackDevServer.headers.get('access-control-allow-origin')).toBe('http://localhost:5218');
    const reservation = await fetch(url, { method: 'POST', headers: { origin: 'http://localhost:5218', 'content-type': 'application/json' }, body: '{}' });
    expect(reservation.status).toBe(200);
    expect(reservation.headers.get('access-control-allow-origin')).toBe('http://localhost:5218');
    // Colyseus writes this answer itself, so the header comes with the others it is given.
    expect(reservation.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('tells no origin it may read an answer unless the policy allows it: never the wildcard Colyseus sends by default', async () => {
    for (const requestPath of ['/healthz', '/__healthcheck', '/']) {
      const foreign = await fetch(`${baseUrl}${requestPath}`, { headers: { origin: 'https://evil.example.com' } });
      expect(foreign.headers.get('access-control-allow-origin'), requestPath).toBeNull();
      const noOrigin = await fetch(`${baseUrl}${requestPath}`);
      expect(noOrigin.headers.get('access-control-allow-origin'), requestPath).toBeNull();
    }
  });

  it('refuses a WebSocket upgrade from a foreign origin with 403 and completes one from an allowed origin or from no browser at all', async () => {
    expect(await upgradeStatus(server.port, { origin: 'https://evil.example.com' })).toBe(403);
    expect(await upgradeStatus(server.port, { origin: 'http://127.evil.com' })).toBe(403);
    expect(await upgradeStatus(server.port, { origin: 'null' })).toBe(403);
    expect(await upgradeStatus(server.port, { origin: 'https://tunnel.example.com' })).toBe(101);
    expect(await upgradeStatus(server.port, { origin: baseUrl })).toBe(101);
    expect(await upgradeStatus(server.port, {})).toBe(101);
  });

  it('refuses an upgrade whose Origin matches its own Host but is not listed: a domain pointed at this server names itself in both', async () => {
    expect(await upgradeStatus(server.port, { origin: 'http://rebound.example.net:5119', host: 'rebound.example.net:5119' })).toBe(403);
  });

  it('still serves the files and the health check to a foreign origin: only what changes state is guarded', async () => {
    const page = await fetch(`${baseUrl}/`, { headers: { origin: 'https://evil.example.com' } });
    expect(page.status).toBe(200);
    const health = await fetch(`${baseUrl}/healthz`, { headers: { origin: 'https://evil.example.com' } });
    expect(health.status).toBe(200);
  });

  it('refuses an oversized matchmaking body, declared or streamed, and a small one still reaches Colyseus', async () => {
    const url = `${baseUrl}/matchmake/joinById/world`;
    const headers = { 'content-type': 'application/json' };
    const oversized = await fetch(url, { method: 'POST', headers, body: 'x'.repeat(OVERSIZED_BODY_BYTES) }).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(oversized);
    // Chunked, so no content-length to refuse up front: the stream is cut once it passes the cap.
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 64; index += 1) controller.enqueue(new TextEncoder().encode('y'.repeat(OVERSIZED_BODY_BYTES / 64)));
        controller.close();
      },
    });
    const oversizedStream = await fetch(url, { method: 'POST', headers, body: chunked, duplex: 'half' } as RequestInit).then((response) => response.status, () => 'connection cut');
    expect([413, 'connection cut']).toContain(oversizedStream);
    const small = await fetch(url, { method: 'POST', headers, body: '{}' });
    expect(small.status).toBe(200);
    expect(await small.json()).toMatchObject({ roomId: 'world' });
  });

  it('answers 400 to every request Colyseus could not survive, on its own routes too, and keeps serving', async () => {
    const host = `Host: localhost:${server.port}`;
    const json = ['Content-Type: application/json', 'Content-Length: 2', '', '{}'];
    const hostile: Array<[string, string[]]> = [
      ['an absolute URL as the target of a file', ['GET http://evil.example/healthz HTTP/1.1', host]],
      ['an absolute URL as the target of a matchmaking call', ['POST http://evil.example/matchmake/joinById/world HTTP/1.1', host, ...json]],
      ['a Host that is no host, on a matchmaking call', ['POST /matchmake/joinById/world HTTP/1.1', 'Host: exa[mple', ...json]],
      ['a Host with a port that is no port, on a matchmaking call', ['POST /matchmake/joinById/world HTTP/1.1', 'Host: a:b', ...json]],
      ['a Host that is no host, on the Colyseus health route', ['GET /__healthcheck HTTP/1.1', 'Host: exa[mple']],
      ['a Host carrying a path', ['POST /matchmake/joinById/world HTTP/1.1', 'Host: a/b', ...json]],
      ['an empty Host', ['POST /matchmake/joinById/world HTTP/1.1', 'Host:', ...json]],
      ['a forwarded protocol that is no protocol', ['POST /matchmake/joinById/world HTTP/1.1', host, 'X-Forwarded-Proto: ht tp', ...json]],
      ['two forwarded protocols', ['POST /matchmake/joinById/world HTTP/1.1', host, 'X-Forwarded-Proto: https, http', ...json]],
      ['a target that is not a path', ['GET * HTTP/1.1', host]],
      ...['*:99999999', '*%', '*[', '*:abc'].map((target): [string, string[]] => [`an upgrade whose target is ${target}`, [`GET ${target} HTTP/1.1`, host, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==']]),
      ['an upgrade with a Host that is no host', ['GET /world HTTP/1.1', 'Host: a:b', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==']],
    ];
    for (const [what, lines] of hostile) {
      expect(await rawStatusLine(server.port, lines), what).toBe('HTTP/1.1 400 Bad Request');
    }
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  });

  it('seats a real client through all of it: the reservation, the upgrade and the welcome', async () => {
    const room = await new Client(baseUrl.replace('http', 'ws')).joinById(WORLD_ROOM_ID);
    try {
      const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(WIRE.welcome, (message: WelcomeMessage) => resolve(message)));
      expect(welcome.slot).toBe(0);
      expect(server.room.seatsTaken).toBe(1);
      expect(await (await fetch(`${baseUrl}/healthz`)).json()).toMatchObject({ ok: true, seatsTaken: 1 });
    } finally {
      await room.leave();
    }
  });

  it('lets a well-formed request through a proxy reach matchmaking: one forwarded protocol and the public Host', async () => {
    const proxied = await rawStatusLine(server.port, ['POST /matchmake/joinById/world HTTP/1.1', 'Host: play.example.com', 'X-Forwarded-Proto: https', 'Content-Type: application/json', 'Content-Length: 2', '', '{}']);
    expect(proxied).toBe('HTTP/1.1 200 OK');
  });
});

describe('one process in production: only the listed origins get in', () => {
  beforeAll(async () => {
    server = await startServer({ port: 0, seed: 8, originPolicy: readOriginPolicy({ allowedOrigins: 'https://play.example.com', allowLoopback: false }), clientDirectory: undefined });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('takes an upgrade from the listed origin whatever Host a proxy presents, and refuses a loopback page and a rebound domain', async () => {
    expect(await upgradeStatus(server.port, { origin: 'https://play.example.com', host: 'internal:8080' })).toBe(101);
    expect(await upgradeStatus(server.port, { origin: 'http://localhost:5218' })).toBe(403);
    expect(await upgradeStatus(server.port, { origin: baseUrl })).toBe(403);
    expect(await upgradeStatus(server.port, { origin: 'http://rebound.example.net', host: 'rebound.example.net' })).toBe(403);
  });

  it('refuses matchmaking from a loopback page and takes it from the listed origin', async () => {
    const url = `${baseUrl}/matchmake/joinById/world`;
    expect((await fetch(url, { method: 'POST', headers: { origin: 'http://localhost:5218', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { origin: 'https://play.example.com', 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
  });

  it('serves no client files when given no client directory, and still answers /healthz with the security headers', async () => {
    expect((await fetch(`${baseUrl}/`)).status).toBe(404);
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('one process on a busy port', () => {
  it('fails the boot with the reason instead of waiting for ever', async () => {
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, resolve));
    const { port } = occupied.address() as net.AddressInfo;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(startServer({ port, seed: 9, originPolicy: readOriginPolicy({ allowedOrigins: undefined, allowLoopback: true }), clientDirectory: undefined })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      logged.mockRestore();
      await new Promise((resolve) => occupied.close(resolve));
    }
  });
});

// ---- Helpers ----

let server: WorldServer;
let baseUrl: string;

const CONTENT_SECURITY_POLICY =
  "default-src 'self';script-src 'self' 'wasm-unsafe-eval';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;connect-src 'self';worker-src 'self' blob:;object-src 'none';base-uri 'self';frame-ancestors 'none';form-action 'self'";
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIG_ASSET_BYTES = 8 * 1024 * 1024;
/** Far over any cap the edge could reasonably have: a join carries `{}`. */
const OVERSIZED_BODY_BYTES = 1024 * 1024;
const SECRET_CONTENT = 'what the file next to the client build holds';
const HIDDEN_CONTENT = 'what a dotfile in the client build holds';

/** A directory shaped like `packages/client/dist`, with a secret next to it that must stay unreachable. */
async function fakeClientBuild(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'novaland-client-'));
  const dist = path.join(parent, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await mkdir(path.join(dist, 'sprites'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Novaland</title></head><body></body></html>');
  await writeFile(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("bundle")');
  await writeFile(path.join(dist, 'assets', 'big-abc123.js'), Buffer.alloc(BIG_ASSET_BYTES, 0x2f));
  await writeFile(path.join(dist, 'assets', '.hidden'), HIDDEN_CONTENT);
  await writeFile(path.join(dist, 'sprites', 'player.png'), PNG_HEADER);
  await writeFile(path.join(dist, '.hidden'), HIDDEN_CONTENT);
  await writeFile(path.join(parent, 'secret.txt'), SECRET_CONTENT);
  return dist;
}

/** `GET url` sent as is (`fetch` would normalise `..` away before the server saw it, and adds headers of its own): the status and the body. */
function rawGet(port: number, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: url, method: 'GET', headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Writes the request lines to a bare socket, as no HTTP client would let a test do, and returns the status line of the answer (or says there was none). */
function rawStatusLine(port: number, lines: readonly string[]): Promise<string> {
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

/** Starts downloading `url` and destroys the socket after the first chunk, like a tab closed mid-load. */
function abortDownload(port: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: url, method: 'GET' }, (response) => {
      response.once('data', () => {
        response.destroy();
        resolve();
      });
    });
    request.on('error', reject);
    request.end();
  });
}

interface Burst {
  readonly url: string;
  readonly requests: number;
}

/** Writes `requests` GETs of `url` to one connection in a single write, without waiting for any answer, and hangs up shortly after. */
function sendBurstAndHangUp(port: number, { url, requests }: Burst): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${url} HTTP/1.1\r\nHost: localhost\r\n\r\n`.repeat(requests));
      setTimeout(() => socket.destroy(), 300);
    });
    socket.on('data', () => undefined);
    socket.on('error', () => undefined);
    socket.on('close', () => resolve());
  });
}

/** The statuses of GETs sent one after another on a single kept-alive connection, each after the answer to the one before. */
async function sequentialStatuses(port: number, urls: readonly string[]): Promise<number[]> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const statuses: number[] = [];
  try {
    for (const url of urls) {
      statuses.push(
        await new Promise<number>((resolve, reject) => {
          const request = http.request({ host: '127.0.0.1', port, path: url, method: 'GET', agent }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
          });
          request.on('error', reject);
          request.end();
        }),
      );
    }
  } finally {
    agent.destroy();
  }
  return statuses;
}

/** How many descriptors this process holds open (`/dev/fd` on macOS and Linux). */
function openDescriptorCount(): number {
  return readdirSync('/dev/fd').length;
}

/** The descriptor count once it has come back down to `baseline`, or whatever it is after a second. */
async function descriptorCountOnceSettled(baseline: number): Promise<number> {
  const deadline = Date.now() + 1000;
  let count = openDescriptorCount();
  while (count > baseline && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    count = openDescriptorCount();
  }
  return count;
}

interface UpgradeHeaders {
  /** The `Origin` header; none when undefined, as from a client that is not a browser. */
  readonly origin?: string;
  /** The `Host` header; the address connected to when undefined. */
  readonly host?: string;
}

/** The status of a WebSocket upgrade carrying these headers: 101 when the transport took it, else what refused it. */
function upgradeStatus(port: number, { origin, host }: UpgradeHeaders): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    };
    if (origin !== undefined) headers.origin = origin;
    if (host !== undefined) headers.host = host;
    const request = http.request({ host: '127.0.0.1', port, path: '/world', method: 'GET', headers });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.on('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.end();
  });
}
