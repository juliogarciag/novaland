/**
 * Which browser origins may talk to the world room. A page served by this
 * process is always allowed (same origin: the deployed case); `ALLOWED_ORIGINS`
 * adds others (a client dev server on another host, a tunnel); and outside
 * production a page on the loopback interface may reach a server on the
 * loopback interface, so `pnpm dev:online` and the verification scripts work
 * with nothing set. A request without an `Origin` header did not come from a
 * browser and is let through: a browser always sends one on a WebSocket
 * upgrade and on a cross-origin fetch, which is what the check is for. The
 * same-origin test reads the `Host` header, so a reverse proxy must pass the
 * original `Host` through (or the public origin goes in `ALLOWED_ORIGINS`).
 */
export interface OriginPolicy {
  /** `ALLOWED_ORIGINS=*`: every origin. For throwaway setups only. */
  readonly allowAll: boolean;
  /** Normalised origins (`scheme://host[:port]`, lower case) from `ALLOWED_ORIGINS`. */
  readonly allowedOrigins: ReadonlySet<string>;
  /** Whether a loopback page may reach a loopback server with nothing listed: on in development, off in production, where a proxy may present a loopback `Host`. */
  readonly allowLoopback: boolean;
}

export interface OriginPolicyOptions {
  /** The `ALLOWED_ORIGINS` value. */
  readonly allowedOrigins: string | undefined;
  /** Loopback to loopback allowed. Pass `process.env.NODE_ENV !== 'production'`. */
  readonly allowLoopback: boolean;
}

export interface OriginCheck {
  /** The `Origin` request header, if any. */
  readonly origin: string | undefined;
  /** The `Host` request header: where the browser thinks this server is. */
  readonly host: string | undefined;
  readonly policy: OriginPolicy;
}

/**
 * The policy in `ALLOWED_ORIGINS`: a comma-separated list of `http(s)`
 * origins, or `*`. Throws on anything that is not such an origin (a path, a
 * bare host, a `ws://` address, which a browser never sends as its `Origin`),
 * so a typo stops the boot instead of silently refusing every player.
 */
export function readOriginPolicy({ allowedOrigins: value, allowLoopback }: OriginPolicyOptions): OriginPolicy {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return { allowAll: true, allowedOrigins: new Set(), allowLoopback };
  const allowedOrigins = new Set<string>();
  for (const entry of entries) {
    const origin = listedOrigin(entry);
    if (origin === undefined) throw new Error(`ALLOWED_ORIGINS must list origins like https://play.example.com, got ${JSON.stringify(entry)}`);
    allowedOrigins.add(origin);
  }
  return { allowAll: false, allowedOrigins, allowLoopback };
}

/** Whether a request carrying `origin` may reach the world room on `host`. */
export function isOriginAllowed({ origin, host, policy }: OriginCheck): boolean {
  if (origin === undefined) return true;
  if (policy.allowAll) return true;
  const originUrl = parseOrigin(origin);
  if (originUrl === undefined) return false;
  if (policy.allowedOrigins.has(originUrl.origin.toLowerCase())) return true;
  // The Host is read with the Origin's scheme, so a default port spelled out on either side (`play.example.com:443`) compares equal to one left out.
  const hostUrl = host === undefined ? undefined : parseOrigin(`${originUrl.protocol}//${host}`);
  if (hostUrl === undefined) return false;
  if (originUrl.host === hostUrl.host) return true;
  return policy.allowLoopback && isLoopback(originUrl.hostname) && isLoopback(hostUrl.hostname);
}

// ---- Helpers ----

/** The normalised origin of an allow-list entry, or undefined when the entry carries more than an origin (a path, a query, a fragment) or an `http(s)` scheme is missing. */
function listedOrigin(entry: string): string | undefined {
  const url = parseOrigin(entry);
  if (url === undefined) return undefined;
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]$/.test(entry)) return undefined;
  return url.origin.toLowerCase();
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

/** `localhost`, a `*.localhost` name (browsers resolve those to loopback), `[::1]`, or a `127.x.x.x` literal. `new URL` has already canonicalised IPv4 spellings (`127.1`, `0177.0.0.1`) to dotted quads, so a DNS name such as `127.evil.com` does not match. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}
