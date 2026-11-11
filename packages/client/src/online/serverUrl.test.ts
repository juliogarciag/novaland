import { describe, expect, it } from 'vitest';
import { worldServerUrl } from './serverUrl';

describe('worldServerUrl', () => {
  it('is the configured server when VITE_SERVER_URL is set, in dev and in production', () => {
    expect(worldServerUrl({ configured: 'ws://localhost:5118', isProduction: false, pageOrigin: 'http://localhost:5218' })).toBe('ws://localhost:5118');
    expect(worldServerUrl({ configured: ' wss://world.example.com ', isProduction: true, pageOrigin: 'https://play.example.com' })).toBe('wss://world.example.com');
  });

  it('is the page origin in production when nothing is configured: the server that served the page runs the world', () => {
    expect(worldServerUrl({ configured: undefined, isProduction: true, pageOrigin: 'https://play.example.com' })).toBe('https://play.example.com');
    expect(worldServerUrl({ configured: '', isProduction: true, pageOrigin: 'http://localhost:5119' })).toBe('http://localhost:5119');
  });

  it('is undefined in dev when nothing is configured: plain `pnpm dev` is the solo game', () => {
    expect(worldServerUrl({ configured: undefined, isProduction: false, pageOrigin: 'http://localhost:5173' })).toBeUndefined();
    expect(worldServerUrl({ configured: '  ', isProduction: false, pageOrigin: 'http://localhost:5173' })).toBeUndefined();
  });
});
