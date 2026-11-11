import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { __testing__, startWorldServer, type WorldFront } from './startWorldServer';

describe('startWorldServer', () => {
  it('leaves nothing behind when the boot fails after the port opened: the port is closed and the next boot works', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const front = frontWhoseGuardFails();
    try {
      await expect(startWorldServer({ port: 0, seed: 1, front })).rejects.toThrow('the guard could not be put in place');
      expect(front.httpServer.listening).toBe(false);
      const next = await startBareWorldServer({ port: 0, seed: 1 });
      expect(next.room.seatsTaken).toBe(0);
      await next.stop();
    } finally {
      logged.mockRestore();
    }
  });
});

// ---- Helpers ----

const { startBareWorldServer } = __testing__;

/** A front with nothing to serve whose guard throws, as the real one does when it does not find the listeners it expects. */
function frontWhoseGuardFails(): WorldFront {
  return {
    httpServer: createServer(),
    mountRoutes: () => undefined,
    matchmakingHeaders: () => ({}),
    guardRequests: () => {
      throw new Error('the guard could not be put in place');
    },
  };
}
