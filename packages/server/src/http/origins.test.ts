import { describe, expect, it } from 'vitest';
import { isOriginAllowed, readAllowedOrigins, SAME_ORIGIN_ONLY } from './origins';

describe('isOriginAllowed', () => {
  it('lets a request without an Origin through: it did not come from a browser', () => {
    expect(isOriginAllowed({ origin: undefined, host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('allows the origin the page was served from, whatever the scheme (a proxy may terminate TLS)', () => {
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://play.example.com:8080', host: 'play.example.com:8080', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://PLAY.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('refuses another host, another port, a null origin and junk', () => {
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com:8443', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com.evil.net', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'null', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'not an origin', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'file:///etc/passwd', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://play.example.com', host: undefined, policy: SAME_ORIGIN_ONLY })).toBe(false);
  });

  it('allows the origins in the policy, and nothing more', () => {
    const policy = readAllowedOrigins('https://tunnel.example.com, http://localhost:5218');
    expect(isOriginAllowed({ origin: 'https://tunnel.example.com', host: 'play.example.com', policy })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://Tunnel.example.com', host: 'play.example.com', policy })).toBe(true);
    expect(isOriginAllowed({ origin: 'https://other.example.com', host: 'play.example.com', policy })).toBe(false);
  });

  it('lets a loopback page reach a loopback server with nothing configured (dev: Vite on one port, the room on another)', () => {
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://127.0.0.1:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: '[::1]:5118', policy: SAME_ORIGIN_ONLY })).toBe(true);
  });

  it('does not let a loopback page reach a deployed server, nor a remote page reach a loopback server', () => {
    expect(isOriginAllowed({ origin: 'http://localhost:5218', host: 'play.example.com', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
    expect(isOriginAllowed({ origin: 'http://localhost.evil.com:5218', host: 'localhost:5118', policy: SAME_ORIGIN_ONLY })).toBe(false);
  });

  it('allows everything only when asked for with *', () => {
    const policy = readAllowedOrigins('*');
    expect(policy.allowAll).toBe(true);
    expect(isOriginAllowed({ origin: 'https://evil.example.com', host: 'play.example.com', policy })).toBe(true);
  });
});

describe('readAllowedOrigins', () => {
  it('is same-origin only when unset or empty', () => {
    expect(readAllowedOrigins(undefined)).toEqual({ allowAll: false, allowedOrigins: new Set() });
    expect(readAllowedOrigins('')).toEqual({ allowAll: false, allowedOrigins: new Set() });
    expect(readAllowedOrigins(' , ')).toEqual({ allowAll: false, allowedOrigins: new Set() });
  });

  it('normalises the listed origins', () => {
    expect([...readAllowedOrigins('HTTPS://Tunnel.Example.com/, http://localhost:5218').allowedOrigins]).toEqual(['https://tunnel.example.com', 'http://localhost:5218']);
  });

  it('refuses entries that are not bare origins, so a typo stops the boot', () => {
    for (const bad of ['play.example.com', 'https://play.example.com/path', 'https://user:pw@play.example.com', 'ftp://play.example.com', 'https://', 'https://play.example.com?x=1']) {
      expect(() => readAllowedOrigins(bad), bad).toThrow(/ALLOWED_ORIGINS/);
    }
  });
});
