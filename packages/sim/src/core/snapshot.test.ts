import { addComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { readTileGrid, spawnPoint } from '../content/levels/grid';
import { TerrainDefId } from '../features/terrain/defs';
import { solidRectangles } from '../features/terrain/rectangles';
import { __testing__ } from './create';
import { initPhysics } from './physics';
import { Sim } from './sim';
import { hashSnapshot, toBase64, type SimSnapshot } from './snapshot';
import { DefRef, Extents } from './transform';

describe('snapshot', () => {
  it('is plain JSON that survives a round trip', async () => {
    const sim = await createSimInternal({ seed: 3 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    sim.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    const snapshot = sim.snapshot();
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
    expect(hashSnapshot(roundTripped)).toBe(hashSnapshot(snapshot));
    sim.destroy();
  });

  it('records every component field of every entity plus level, capacity, tick and rng', async () => {
    const sim = await createSimInternal({ seed: 3 });
    sim.step([{ type: 'player/join', slot: 0 }]);
    const snapshot = sim.snapshot();
    expect(snapshot.level).toBe(sim.level.name);
    expect(snapshot.capacity).toBe(sim.capacity);
    expect(snapshot.tick).toBe(1);
    const player = snapshot.entities.find((e) => e.components['Player'] !== undefined);
    expect(player?.components).toEqual({
      Body: { handle: expect.any(Number) },
      DefRef: { id: expect.any(Number) },
      Extents: { halfHeight: 0.4, halfWidth: 0.4 },
      MoveIntent: { x: 0, y: 0 },
      Player: { slot: 0 },
      Position: spawnPoint(sim.level),
    });
    expect(snapshot.entities.filter((e) => e.components['TerrainCollider'])).toHaveLength(
      solidRectangles(readTileGrid(sim.level)).length,
    );
    expect(snapshot.physics.length).toBeGreaterThan(100);
    sim.destroy();
  });

  it('hashes the same regardless of the order components were attached in', async () => {
    await initPhysics();
    const level = { name: 'empty', legend: { '.': TerrainDefId.Grass }, rows: ['....', '....'], spawn: { column: 0, row: 0 } };
    const a = new Sim({ seed: 0, level, capacity: 8 }, []);
    const b = new Sim({ seed: 0, level, capacity: 8 }, []);
    const ea = a.createEntity();
    addComponent(a.world, ea, a.store(Extents));
    addComponent(a.world, ea, a.store(DefRef));
    const eb = b.createEntity();
    addComponent(b.world, eb, b.store(DefRef));
    addComponent(b.world, eb, b.store(Extents));
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(hashSnapshot(a.snapshot())).toBe(hashSnapshot(b.snapshot()));
    a.destroy();
    b.destroy();
  });

  it('has a stable hash (known answer)', () => {
    const fixed: SimSnapshot = { version: 1, seed: 7, level: 'x', capacity: 2, tick: 3, rng: 9, entities: [{ id: 1, components: { A: { v: 1.5 } } }], physics: 'AAAA' };
    expect(hashSnapshot(fixed)).toBe(hashSnapshot(JSON.parse(JSON.stringify(fixed))));
    expect(hashSnapshot(fixed)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashSnapshot(fixed)).toBe('e146e1b7');
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

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;
