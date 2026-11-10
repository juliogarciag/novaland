import { describe, expect, it } from 'vitest';
import { isOriginAllowed, readOriginPolicy } from './origins';

describe('isOriginAllowed', () => {
  it('lets a request without an Origin through: it did not come from a browser', () => {
    expect(isOriginAllowed(undefined, PRODUCTION)).toBe(true);
    expect(isOriginAllowed(undefined, DEVELOPMENT)).toBe(true);
  });

  it('allows the listed origins in any spelling a browser may send: case, a default port spelled out', () => {
    expect(isOriginAllowed('https://play.example.com', PRODUCTION)).toBe(true);
    expect(isOriginAllowed('https://PLAY.example.com', PRODUCTION)).toBe(true);
    expect(isOriginAllowed('https://play.example.com:443', PRODUCTION)).toBe(true);
    expect(isOriginAllowed('https://tunnel.example.com', PRODUCTION)).toBe(true);
  });

  it('refuses another host, another port, another scheme, a null origin, several origins at once and junk', () => {
    expect(isOriginAllowed('https://evil.example.com', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('https://play.example.com:8443', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('http://play.example.com', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('https://play.example.com.evil.net', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('null', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('https://evil.example.com, https://play.example.com', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('https://play.example.com, https://evil.example.com', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('not an origin', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('file:///etc/passwd', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('wss://play.example.com', PRODUCTION)).toBe(false);
  });

  it('never trusts the request to say who it is: an origin that is not listed is refused whatever host the request names (a rebound domain names itself)', () => {
    // There is no Host parameter to pass: the policy alone decides.
    expect(isOriginAllowed('http://rebound.example.net:5119', PRODUCTION)).toBe(false);
  });

  it('lets any loopback page in outside production with nothing configured (dev: Vite on one port, the room on another), in any loopback spelling', () => {
    expect(isOriginAllowed('http://localhost:5218', DEVELOPMENT)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5218', DEVELOPMENT)).toBe(true);
    expect(isOriginAllowed('http://[::1]:5218', DEVELOPMENT)).toBe(true);
    expect(isOriginAllowed('http://127.1:5218', DEVELOPMENT)).toBe(true);
    expect(isOriginAllowed('http://app.localhost:5218', DEVELOPMENT)).toBe(true);
  });

  it('does not take a remote page, nor a name that merely looks like loopback, for a loopback page', () => {
    expect(isOriginAllowed('https://evil.example.com', DEVELOPMENT)).toBe(false);
    expect(isOriginAllowed('http://localhost.evil.com:5218', DEVELOPMENT)).toBe(false);
    expect(isOriginAllowed('http://127.evil.com:5218', DEVELOPMENT)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1.nip.io', DEVELOPMENT)).toBe(false);
  });

  it('turns the loopback rule off in production: a localhost page is a stranger unless it is listed', () => {
    expect(isOriginAllowed('http://localhost:5218', PRODUCTION)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:8080', PRODUCTION)).toBe(false);
    const listed = readOriginPolicy({ allowedOrigins: 'http://localhost:5119', allowLoopback: false });
    expect(isOriginAllowed('http://localhost:5119', listed)).toBe(true);
    expect(isOriginAllowed('http://localhost:5120', listed)).toBe(false);
  });

  it('allows everything only when asked for with *', () => {
    const policy = readOriginPolicy({ allowedOrigins: '*', allowLoopback: false });
    expect(policy.allowAll).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', policy)).toBe(true);
  });
});

describe('readOriginPolicy', () => {
  it('is loopback only when unset or empty outside production', () => {
    expect(DEVELOPMENT).toEqual({ allowAll: false, allowedOrigins: new Set(), allowLoopback: true });
    expect(readOriginPolicy({ allowedOrigins: ' , ', allowLoopback: true })).toEqual({ allowAll: false, allowedOrigins: new Set(), allowLoopback: true });
  });

  it('stops the boot in production when nothing is listed: no browser could ever get in', () => {
    for (const nothing of [undefined, '', ' , ']) {
      expect(() => readOriginPolicy({ allowedOrigins: nothing, allowLoopback: false }), String(nothing)).toThrow(/ALLOWED_ORIGINS must name the origin players open/);
    }
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

/** A deployed server told its two origins. */
const PRODUCTION = readOriginPolicy({ allowedOrigins: 'https://play.example.com, https://tunnel.example.com', allowLoopback: false });
/** Nothing configured outside production: loopback pages only. */
const DEVELOPMENT = readOriginPolicy({ allowedOrigins: undefined, allowLoopback: true });
