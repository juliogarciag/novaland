import { readdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorldServer, type WorldServer } from '../world/startWorldServer';
import { MAX_SEATS } from '../world/tuning';
import { answerHealthChecks } from './answerHealthChecks';
import { readOriginPolicy } from './origins';
import { refuseForeignOrigins } from './refuseForeignOrigins';
import { __testing__, serveClientFiles } from './serveClientFiles';

describe('one process: the client files, /healthz and the origin check in front of the world room', () => {
  beforeAll(async () => {
    clientDirectory = await fakeClientBuild();
    server = await startWorldServer({ port: 0, seed: 7 });
    refuseForeignOrigins(server.httpServer, readOriginPolicy({ allowedOrigins: 'https://tunnel.example.com', allowLoopback: true }));
    answerHealthChecks(server.httpServer, () => ({ ok: true, roomId: server.roomId, seats: MAX_SEATS, seatsTaken: server.room.seatsTaken, tick: server.room.tick }));
    serveClientFiles(server.httpServer, { directory: clientDirectory });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('serves index.html at / with the security headers and no long cache', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>Novaland</title>');
  });

  it('serves the hashed assets as immutable with their content type, and the sprites under /sprites', async () => {
    const script = await fetch(`${base}/assets/index-abc123.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await script.text()).toBe('console.log("bundle")');
    const sprite = await fetch(`${base}/sprites/player.png`);
    expect(sprite.status).toBe(200);
    expect(sprite.headers.get('content-type')).toBe('image/png');
    expect(sprite.headers.get('cache-control')).toBe('no-cache');
    expect((await sprite.arrayBuffer()).byteLength).toBe(PNG_HEADER.length);
  });

  it('answers 304 to a matching ETag and headers only to HEAD', async () => {
    const first = await fetch(`${base}/`);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/"/);
    const again = await fetch(`${base}/`, { headers: { 'if-none-match': etag ?? '' } });
    expect(again.status).toBe(304);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(first.headers.get('content-length'));
    expect(await head.text()).toBe('');
  });

  it('never serves a file outside the client directory, a dotfile or a directory listing', async () => {
    for (const url of ['/../secret.txt', '/assets/..%2f..%2fsecret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/.hidden', '/assets/.hidden', '/%00', '/assets/']) {
      const { status, body } = await rawGet(server.port, url);
      expect(status, url).not.toBe(200);
      expect(body, url).not.toContain('secret');
      expect(body, url).not.toContain('hidden');
    }
  });

  it('hands unknown paths and other methods over to Colyseus instead of answering them', async () => {
    const missing = await fetch(`${base}/missing.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-security-policy')).toBeNull();
    const post = await fetch(`${base}/`, { method: 'POST' });
    expect(post.status).toBe(404);
    expect(post.headers.get('content-security-policy')).toBeNull();
  });

  it('closes the file when the browser gives up mid-download: no descriptor is left open', async () => {
    await abortDownload(server.port, '/assets/big-abc123.js'); // warm up, so the baseline holds no keep-alive socket about to close
    const before = await descriptorCountOnceSettled(openDescriptorCount());
    for (let attempt = 0; attempt < 5; attempt += 1) await abortDownload(server.port, '/assets/big-abc123.js');
    expect(await descriptorCountOnceSettled(before)).toBeLessThanOrEqual(before);
  });

  it('opens no file for a browser that left before the lookup finished, and does not crash on it', async () => {
    const before = await descriptorCountOnceSettled(openDescriptorCount());
    for (let attempt = 0; attempt < 5; attempt += 1) await leaveBeforeTheAnswer(server.port, '/assets/big-abc123.js');
    expect(await descriptorCountOnceSettled(before)).toBeLessThanOrEqual(before);
    const stillServing = await fetch(`${base}/assets/index-abc123.js`);
    expect(stillServing.status).toBe(200);
  });

  it('answers /healthz with the room in it', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, roomId: 'world', seats: MAX_SEATS, seatsTaken: 0, tick: expect.any(Number) });
  });

  it('refuses a matchmaking call from a foreign origin with 403, before Colyseus (no CORS headers for it), and lets same-origin and listed origins through', async () => {
    const foreign = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect(foreign.headers.get('connection')).toBe('close');
    expect(await foreign.json()).toEqual({ error: 'origin not allowed' });
    const same = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: base } });
    expect(same.status).toBe(204);
    const listed = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: 'https://tunnel.example.com' } });
    expect(listed.status).toBe(204);
    const loopbackDevServer = await fetch(`${base}/matchmake/joinById/world`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5218' } });
    expect(loopbackDevServer.status).toBe(204);
  });

  it('refuses a WebSocket upgrade from a foreign origin with 403 and completes one from the same origin', async () => {
    expect(await upgradeStatus(server.port, 'https://evil.example.com')).toBe(403);
    expect(await upgradeStatus(server.port, 'http://127.evil.com')).toBe(403);
    expect(await upgradeStatus(server.port, base)).toBe(101);
    expect(await upgradeStatus(server.port, undefined)).toBe(101);
  });

  it('still serves the files and the health check to a foreign origin: only the world room is guarded', async () => {
    const page = await fetch(`${base}/`, { headers: { origin: 'https://evil.example.com' } });
    expect(page.status).toBe(200);
    const health = await fetch(`${base}/healthz`, { headers: { origin: 'https://evil.example.com' } });
    expect(health.status).toBe(200);
  });
});

describe('serveClientFiles with a client directory whose own path contains "assets"', () => {
  it('still caches only the files under the build\'s assets/ folder for a year', async () => {
    const directory = await fakeClientBuild('assets');
    const plain = http.createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    serveClientFiles(plain, { directory });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const address = plain.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.headers.get('cache-control')).toBe('no-cache');
      const script = await fetch(`http://127.0.0.1:${port}/assets/index-abc123.js`);
      expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    } finally {
      await new Promise((resolve) => plain.close(resolve));
    }
  });
});

// ---- Helpers ----

let server: WorldServer;
let clientDirectory: string;
let base: string;
const { CONTENT_SECURITY_POLICY } = __testing__;

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIG_ASSET_BYTES = 8 * 1024 * 1024;

/** A directory shaped like `packages/client/dist` inside a parent named `parentName`, with a secret next to it that must stay unreachable. */
async function fakeClientBuild(parentName = 'dist'): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'novaland-client-'));
  const dist = path.join(parent, parentName);
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await mkdir(path.join(dist, 'sprites'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Novaland</title></head><body></body></html>');
  await writeFile(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("bundle")');
  await writeFile(path.join(dist, 'assets', 'big-abc123.js'), Buffer.alloc(BIG_ASSET_BYTES, 0x2f));
  await writeFile(path.join(dist, 'assets', '.hidden'), 'hidden');
  await writeFile(path.join(dist, 'sprites', 'player.png'), PNG_HEADER);
  await writeFile(path.join(dist, '.hidden'), 'hidden');
  await writeFile(path.join(parent, 'secret.txt'), 'secret');
  return dist;
}

/** `GET url` sent as is (`fetch` would normalise `..` away before the server saw it): the status and the body. */
function rawGet(port: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: url, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
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

/** Sends `GET url` and destroys the socket at once, before the server can have answered: it is still looking the file up. */
function leaveBeforeTheAnswer(port: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: url, method: 'GET' });
    request.on('error', () => undefined);
    request.on('socket', (socket) => {
      socket.on('connect', () => {
        request.flushHeaders();
        setImmediate(() => {
          socket.destroy();
          resolve();
        });
      });
      socket.on('error', reject);
    });
    request.end();
  });
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

/** The status of a WebSocket upgrade on the matchmaking path carrying `origin` (none when undefined): 101 when the transport took it, else what refused it. */
function upgradeStatus(port: number, origin: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    };
    if (origin !== undefined) headers.origin = origin;
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
