import { describe, expect, it } from 'vitest';
import { __testing__ } from './screens';
import { WORLD_SEATS } from './tuning';

const { describeStatus } = __testing__;

describe('describeStatus', () => {
  it('tells the player what is going on, with the seats of a full world and the seconds until the next try', () => {
    const soon = Date.now() + 4200;
    expect(describeStatus({ kind: 'connecting', attempt: 1 })).toBe('Connecting to the world…');
    expect(describeStatus({ kind: 'connecting', attempt: 3 })).toBe('Connecting to the world… (attempt 3)');
    expect(describeStatus({ kind: 'full', retryAt: soon })).toBe(`The world is full (${WORLD_SEATS}/${WORLD_SEATS} online). Retrying in 5s.`);
    expect(describeStatus({ kind: 'disconnected', retryAt: soon, attempt: 2 })).toBe('Disconnected from the world. Retrying in 5s…');
    expect(describeStatus({ kind: 'disconnected', retryAt: Date.now() - 100, attempt: 2 })).toBe('Disconnected from the world. Retrying in 0s…');
    expect(describeStatus({ kind: 'away' })).toBe('You were away too long, so the server freed your seat. Rejoin to play again.');
    expect(describeStatus({ kind: 'incompatible', reason: 'this client has no level named "moon"' })).toBe('Cannot play on this server: this client has no level named "moon".');
    expect(describeStatus({ kind: 'online', slot: 0 })).toBe('');
  });
});
