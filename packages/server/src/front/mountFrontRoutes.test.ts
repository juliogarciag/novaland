import express from 'express';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mountFrontRoutes } from './mountFrontRoutes';

describe('mountFrontRoutes', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((httpServer) => new Promise((resolve) => httpServer.close(resolve))));
  });

  it('answers /health with 503 while there is nothing to report, and with the report once there is', async () => {
    const reports: Array<Record<string, unknown> | undefined> = [undefined, { roomId: 'world', tick: 3 }];
    const url = await appWith({ clientDirectory: undefined, health: () => reports.shift() });
    const starting = await fetch(`${url}/health`);
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({ ok: false });
    const ready = await fetch(`${url}/health`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(await ready.json()).toEqual({ ok: true, roomId: 'world', tick: 3 });
  });

  it('answers a HEAD on /health with no body', async () => {
    const url = await appWith({ clientDirectory: undefined, health: () => ({}) });
    const head = await fetch(`${url}/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('serves nothing else without a client directory, and does not say what it runs on', async () => {
    const url = await appWith({ clientDirectory: undefined, health: () => ({}) });
    const root = await fetch(`${url}/`);
    expect(root.status).toBe(404);
    expect(root.headers.get('x-powered-by')).toBeNull();
    expect(root.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

// ---- Helpers ----

const servers: HttpServer[] = [];

/** The address of a listening Express app with the front routes mounted. */
async function appWith(options: Parameters<typeof mountFrontRoutes>[1]): Promise<string> {
  const app = express();
  mountFrontRoutes(app, options);
  const httpServer = await new Promise<HttpServer>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(httpServer);
  return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
}
