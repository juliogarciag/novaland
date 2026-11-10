import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { __testing__ } from './startWorldServer';

const { refuseLargeRequestBodies } = __testing__;

describe('the request body cap', () => {
  it("wraps the server's one request listener in place of it", () => {
    const httpServer = createServer();
    const router = () => undefined;
    httpServer.on('request', router);
    refuseLargeRequestBodies(httpServer, 16);
    expect(httpServer.listeners('request')).toHaveLength(1);
    expect(httpServer.listeners('request')[0]).not.toBe(router);
  });

  it('refuses to install when the server has no request listener', () => {
    expect(() => refuseLargeRequestBodies(createServer(), 16)).toThrow(/found 0/);
  });

  it('refuses to install when something besides the router listens for requests', () => {
    const httpServer = createServer();
    httpServer.on('request', () => undefined);
    httpServer.on('request', () => undefined);
    expect(() => refuseLargeRequestBodies(httpServer, 16)).toThrow(/found 2/);
    expect(httpServer.listeners('request')).toHaveLength(2);
  });
});
