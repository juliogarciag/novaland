import { describe, expect, it } from 'vitest';
import { createSim } from './create';
import { hashSnapshot, toBase64 } from './snapshot';

describe('snapshot', () => {
  it('is plain JSON that survives a round trip', async () => {
    const sim = await createSim({ seed: 3 });
    sim.step([{ type: 'join', slot: 0 }]);
    sim.step([{ type: 'move', slot: 0, x: 1, y: 0 }]);
    const snapshot = sim.snapshot();
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
    expect(hashSnapshot(roundTripped)).toBe(hashSnapshot(snapshot));
    sim.destroy();
  });

  it('records every component field of every entity', async () => {
    const sim = await createSim({ seed: 3 });
    sim.step([{ type: 'join', slot: 0 }]);
    const snapshot = sim.snapshot();
    const player = snapshot.entities.find((e) => e.components['Player'] !== undefined);
    expect(player).toBeDefined();
    expect(Object.keys(player?.components ?? {}).sort()).toEqual(
      ['Body', 'DefRef', 'Extents', 'MoveIntent', 'Player', 'Position'],
    );
    expect(player?.components['Position']).toEqual({ x: sim.level.spawn.x, y: sim.level.spawn.y });
    expect(snapshot.entities.filter((e) => e.components['Extents'] && !e.components['Player'])).toHaveLength(
      sim.level.walls.length,
    );
    expect(snapshot.physics.length).toBeGreaterThan(100);
    sim.destroy();
  });

  it('encodes base64 like the standard', () => {
    const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    expect(toBase64(bytes(''))).toBe('');
    expect(toBase64(bytes('f'))).toBe('Zg==');
    expect(toBase64(bytes('fo'))).toBe('Zm8=');
    expect(toBase64(bytes('foo'))).toBe('Zm9v');
    expect(toBase64(bytes('foobar'))).toBe('Zm9vYmFy');
  });
});
