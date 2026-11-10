import { describe, expect, it } from 'vitest';
import { isOriginAllowed, readOriginPolicy } from './origins';

describe('isOriginAllowed', () => {
  it('lets a request without an Origin through: it did not come from a browser', () => {
    expect(isOriginAllowed({ origin: undefined, host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('allows the origin the page was served from, whatever the scheme (a proxy may terminate TLS) and whether the default port is spelled out', () => {
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://play.example.com:8080', host: 'play.example.com:8080', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://PLAY.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: 'play.example.com:443', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://play.example.com', host: 'play.example.com:80', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('refuses another host, another port, a null origin and junk', () => {
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com:8443', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: 'play.example.com:80', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com.evil.net', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'null', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'not an origin', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'file:///etc/passwd', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: undefined, policy: SAME_ORIGIN_ONLY })).toBe(false);
  });

  it('allows the origins in the policy, and nothing more', () => {
    const policy = readOriginPolicy({ allowedOrigins: 'https://tunnel.example.com, http://localhost:5218', allowLoopback: true });
    expect(isOriginAllowed({ origin: 'https://tunnel.example.com', host: 'play.example.com', policy })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://Tunnel.example.com', host: 'play.example.com', policy })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://other.example.com', host: 'play.example.com', policy })).toBe(false);
  });

  it('lets a loopback page reach a loopback server with nothing configured (dev: Vite on one port, the room on another), in any loopback spelling', () => {
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://127.0.0.1:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: '[::1]:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://127.1:5218', host: '127.0.0.1:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://app.localhost:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('does not let a loopback page reach a deployed server, nor a remote page reach a loopback server, nor a name that merely starts with 127.', () => {
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'http://localhost.evil.com:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'http://127.evil.com:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'http://127.0.0.1.nip.io', host: '127.0.0.1:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
  });

  it('turns the loopback rule off in production: a proxy may present a loopback Host, and a localhost page is then a stranger', () => {
    const production = readOriginPolicy({ allowedOrigins: undefined, allowLoopback: false });
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: 'localhost:5118', policy: production })).toBe(false);
    expect(isOriginAllowed({ origin: 'http://127.0.0.1:8080', host: '127.0.0.1:8080', policy: production })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: 'play.example.com', policy: production })).toBe(true);
  });

  it('allows everything only when asked for with *', () => {
    const policy = readOriginPolicy({ allowedOrigins: '*', allowLoopback: false });
    expect(policy.allowAll).toBe(true);
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'play.example.com', policy })).toBe(true);
  });
});

describe('readOriginPolicy', () => {
  it('is same-origin only when unset or empty', () => {
    expect(SAME_ORIGIN_ONLY).toEqual({ allowAll: false, allowedOrigins: new Set(), allowLoopback: true });
    expect(readOriginPolicy({ allowedOrigins: '', allowLoopback: false })).toEqual({ allowAll: false, allowedOrigins: new Set(), allowLoopback: false });
    expect(readOriginPolicy({ allowedOrigins: ' , ', allowLoopback: true })).toEqual({ allowAll: false, allowedOrigins: new Set(), allowLoopback: true });
  });

  it('normalises the listed origins: case, a trailing slash, a spelled-out default port', () => {
    expect([...readOriginPolicy({ allowedOrigins: 'HTTPS://Tunnel.Example.com/, http://localhost:5218, https://play.example.com:443', allowLoopback: true }).allowedOrigins]).toEqual([
      'https://tunnel.example.com',
      'http://localhost:5218',
      'https://play.example.com',
    ]);
  });

  it('refuses entries that are not bare http(s) origins, so a typo stops the boot instead of refusing every player', () => {
    for (const bad of ['play.example.com', 'https://play.example.com/path', 'https://user:pw@play.example.com', 'ftp://play.example.com', 'wss://play.example.com', 'https://', 'https://play.example.com?x=1', 'https://play.example.com#top']) {
      expect(() => readOriginPolicy({ allowedOrigins: bad, allowLoopback: true }), bad).toThrow(/ALLOWED_ORIGINS/);
    }
  });
});

// ---- Helpers ----

/** The policy with nothing configured outside production: same origin, and loopback to loopback. */
const SAME_ORIGIN_ONLY = readOriginPolicy({ allowedOrigins: undefined, allowLoopback: true });
