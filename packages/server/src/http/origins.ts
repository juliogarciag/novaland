/**
 * Which browser origins may talk to the world room. A page served by this
 * process is always allowed (same origin: the deployed case); `ALLOWED_ORIGINS`
 * adds others (a client dev server on another host, a tunnel); and a page on
 * the loopback interface may reach a server on the loopback interface, so
 * `pnpm dev:online` and the verification scripts work with nothing set. A
 * request without an `Origin` header did not come from a browser and is let
 * through: a browser always sends one on a WebSocket upgrade and on a
 * cross-origin fetch, which is what the check is for.
 */
export interface OriginPolicy {
  /** `ALLOWED_ORIGINS=*`: every origin. For throwaway setups only. */
  readonly allowAll: boolean;
  /** Normalised origins (`scheme://host[:port]`, lower case) from `ALLOWED_ORIGINS`. */
  readonly allowedOrigins: ReadonlySet<string>;
}

export interface OriginCheck {
  /** The `Origin` request header, if any. */
  readonly origin: string | undefined;
  /** The `Host` request header: where the browser thinks this server is. */
  readonly host: string | undefined;
  readonly policy: OriginPolicy;
}

export const SAME_ORIGIN_ONLY: OriginPolicy = { allowAll: false, allowedOrigins: new Set() };

/**
 * The policy in `ALLOWED_ORIGINS`: a comma-separated list of origins, or `*`.
 * Throws on anything that is not an origin (a path, a bare host), so a typo
 * stops the boot instead of silently refusing every player.
 */
export function readAllowedOrigins(value: string | undefined): OriginPolicy {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return { allowAll: true, allowedOrigins: new Set() };
  const allowedOrigins = new Set<string>();
  for (const entry of entries) {
    const origin = normalisedOrigin(entry);
    if (origin === undefined) throw new Error(`ALLOWED_ORIGINS must list origins like https://play.example.com, got ${JSON.stringify(entry)}`);
    allowedOrigins.add(origin);
  }
  return { allowAll: false, allowedOrigins };
}

/** Whether a request carrying `origin` may reach the world room on `host`. */
export function isOriginAllowed({ origin, host, policy }: OriginCheck): boolean {
  if (origin === undefined) return true;
  if (policy.allowAll) return true;
  const originUrl = parseOrigin(origin);
  if (originUrl === undefined) return false;
  if (policy.allowedOrigins.has(originUrl.origin.toLowerCase())) return true;
  const hostUrl = host === undefined ? undefined : parseOrigin(`http://${host}`);
  if (hostUrl === undefined) return false;
  if (originUrl.hostname === hostUrl.hostname && originUrl.port === hostUrl.port) return true;
  return isLoopback(originUrl.hostname) && isLoopback(hostUrl.hostname);
}

// ---- Helpers ----

/** `scheme://host[:port]` in lower case, or undefined when `value` is not exactly an origin. */
function normalisedOrigin(value: string): string | undefined {
  const url = parseOrigin(value);
  if (url === undefined) return undefined;
  const bare = `${url.protocol}//${url.host}`;
  // `new URL` accepts a trailing slash, a path or credentials; an allow-list entry must be the bare origin.
  return value.toLowerCase() === bare || value.toLowerCase() === `${bare}/` ? url.origin.toLowerCase() : undefined;
}

/** The URL when `value` is an http(s) or ws(s) origin with a host, else undefined (also for `null`). */
function parseOrigin(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return undefined;
  if (url.hostname === '' || url.username !== '' || url.password !== '') return undefined;
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.startsWith('127.');
}
