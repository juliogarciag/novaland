/**
 * Which browser origins may talk to the world room. The list is told to the
 * server, never worked out from the request: `ALLOWED_ORIGINS` names the
 * origins players open (the deployed site, a tunnel, a client dev server on
 * another host), and outside production any page on the loopback interface
 * may reach it too, so `pnpm dev:online` and the verification scripts work
 * with nothing set.
 *
 * Comparing `Origin` with the request's own `Host` would need no
 * configuration, but it trusts a header the caller chooses: a page on a
 * domain pointed at this server's address (DNS rebinding) presents a matching
 * pair, and a reverse proxy that rewrites `Host` makes real players fail it.
 *
 * A request without an `Origin` header did not come from a browser page and
 * is let through: a browser always sends one on a WebSocket upgrade and on a
 * cross-origin or state-changing fetch, which is what the check is for.
 */
export interface OriginPolicy {
  /** `ALLOWED_ORIGINS=*`: every origin. For throwaway setups only. */
  readonly allowAll: boolean;
  /** Normalised origins (`scheme://host[:port]`, lower case) from `ALLOWED_ORIGINS`. */
  readonly allowedOrigins: ReadonlySet<string>;
  /** Whether any page on the loopback interface is allowed with nothing listed: on in development, off in production. */
  readonly allowLoopback: boolean;
}

export interface OriginPolicyOptions {
  /** The `ALLOWED_ORIGINS` value. */
  readonly allowedOrigins: string | undefined;
  /** Loopback pages allowed. Pass `process.env.NODE_ENV !== 'production'`. */
  readonly allowLoopback: boolean;
}

/**
 * The policy in `ALLOWED_ORIGINS`: a comma-separated list of `http(s)`
 * origins, or `*`. Throws on anything that is not such an origin (a path, a
 * bare host, a `ws://` address, which a browser never sends as its `Origin`,
 * a `*` inside a host, which would match nobody), also next to a `*` entry,
 * and on a policy no browser could ever pass (nothing listed, loopback off),
 * so a typo or a forgotten variable stops the boot instead of silently
 * refusing every player.
 */
export function readOriginPolicy({ allowedOrigins: value, allowLoopback }: OriginPolicyOptions): OriginPolicy {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const allowedOrigins = new Set<string>();
  for (const entry of entries) {
    if (entry === '*') continue;
    const origin = listedOrigin(entry);
    if (origin === undefined) throw new Error(`ALLOWED_ORIGINS must list origins like https://play.example.com, got ${JSON.stringify(entry)}`);
    allowedOrigins.add(origin);
  }
  if (entries.includes('*')) return { allowAll: true, allowedOrigins: new Set(), allowLoopback };
  if (allowedOrigins.size === 0 && !allowLoopback) {
    throw new Error('ALLOWED_ORIGINS must name the origin players open in production, like https://play.example.com (several are separated by commas; * allows any)');
  }
  return { allowAll: false, allowedOrigins, allowLoopback };
}

/**
 * Whether a request carrying this `Origin` header (undefined when it has none)
 * may reach the world room. The header must be spelled the way browsers send
 * it, `scheme://host[:port]` in lower case with no default port and nothing
 * after it: any other spelling of even a listed origin is refused, so what is
 * allowed here is exactly what a browser compares against when it reads
 * `Access-Control-Allow-Origin`.
 */
export function isOriginAllowed(origin: string | undefined, policy: OriginPolicy): boolean {
  if (origin === undefined) return true;
  if (policy.allowAll) return true;
  const originUrl = parseOrigin(origin);
  if (originUrl === undefined || originUrl.origin !== origin) return false;
  if (policy.allowedOrigins.has(origin)) return true;
  return policy.allowLoopback && isLoopback(originUrl.hostname);
}

// ---- Helpers ----

/** The normalised origin of an allow-list entry, or undefined when the entry carries more than an origin (a path, a query, a fragment) or an `http(s)` scheme is missing. */
function listedOrigin(entry: string): string | undefined {
  const url = parseOrigin(entry);
  if (url === undefined) return undefined;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]$/.test(entry) || entry.includes('*')) return undefined;
  return url.origin;
}

/** The URL when `value` is an http(s) origin with a host, else undefined (also for `null`, and for several origins sent in one header). */
function parseOrigin(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  if (url.hostname === '' || url.username !== '' || url.password !== '') return undefined;
  return url;
}

/** `localhost`, a `*.localhost` name (browsers resolve those to loopback), `[::1]`, or a `127.x.x.x` literal. `new URL` has already canonicalised IPv4 spellings (`127.1`, `0177.0.0.1`) to dotted quads, so a DNS name such as `127.evil.com` does not match. The name comes from the `Origin` header, which a page cannot choose: a rebound domain shows its own name there. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}
