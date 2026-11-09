import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import path from 'node:path';
import { handleRequestsFirst } from './handleFirst';

export interface ClientFilesOptions {
  /** The client build (`packages/client/dist`): `index.html`, hashed files under `assets/`, and the sprites. */
  readonly directory: string;
}

/**
 * Serves the built client from `directory` on the same port as the world
 * room: `/` is `index.html`, every other path is the file at that path, and
 * anything that is not a readable file under the directory hands over to the
 * handlers behind it (Colyseus's matchmaking routes, its 404). Only `GET` and
 * `HEAD` are served; dotfiles are not; a path cannot leave the directory.
 * Files under `assets/` carry a content hash in their name and are cached for
 * a year; everything else is revalidated with an ETag on each load.
 */
export function serveClientFiles(httpServer: HttpServer, { directory }: ClientFilesOptions): void {
  const root = path.resolve(directory);
  handleRequestsFirst(httpServer, (request, response, handOver) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      handOver();
      return;
    }
    const file = fileFor(root, request.url ?? '/');
    if (file === undefined) {
      handOver();
      return;
    }
    void sendFile(request, response, file).then((sent) => {
      if (!sent) handOver();
    });
  });
}

/** Response headers every served file carries. The page's CSP names what the client bundle needs and nothing else. */
export function securityHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  };
  if (contentType === CONTENT_TYPES['.html']) {
    headers['content-security-policy'] = CONTENT_SECURITY_POLICY;
    headers['x-frame-options'] = 'DENY';
  }
  return headers;
}

/**
 * Scripts and styles come from this origin (the inline `<style>` in
 * `index.html` needs `unsafe-inline`); the sim's physics is WebAssembly
 * inlined in the bundle (`wasm-unsafe-eval`); Phaser builds textures from
 * `data:` and `blob:` URLs; the world room is reached on this origin (`'self'`
 * matches `ws`/`wss` to the same host).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

// ---- Helpers ----

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** A year: the files under `assets/` are named by content hash, so a new build never reuses a name. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** The absolute file a request path maps to, or undefined when the path is malformed, hidden, or would leave `root`. */
function fileFor(root: string, url: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://host').pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return undefined;
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return undefined;
  const relative = segments.length === 0 ? 'index.html' : segments.join('/');
  const file = path.resolve(root, relative);
  return file === root || file.startsWith(root + path.sep) ? file : undefined;
}

/** True when the file was answered (also a 304); false when it is not a regular file and the request must hand over. */
async function sendFile(request: IncomingMessage, response: ServerResponse, file: string): Promise<boolean> {
  let size: number;
  let modifiedMs: number;
  try {
    const stats = await stat(file);
    if (!stats.isFile()) return false;
    size = stats.size;
    modifiedMs = stats.mtimeMs;
  } catch {
    return false;
  }
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const etag = `W/"${size.toString(16)}-${Math.floor(modifiedMs).toString(16)}"`;
  const headers = {
    ...securityHeaders(contentType),
    'content-type': contentType,
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? IMMUTABLE : REVALIDATE,
    etag,
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  response.writeHead(200, { ...headers, 'content-length': String(size) });
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
  return true;
}
