import { describe, expect, it } from 'vitest';
import type { Command } from './commands';
import { createSimInternal } from './create';
import { hashSnapshot } from './snapshot';

/** A scripted session: joins, moves around, bumps into walls, uses the rng. */
function script(tick: number): Command[] {
  switch (tick) {
    case 0:
      return [{ type: 'player/join', slot: 0 }, { type: 'player/join', slot: 1 }];
    case 1:
      return [{ type: 'player/move', slot: 0, x: 1, y: 0 }, { type: 'player/move', slot: 1, x: -0.3, y: 0.7 }];
    case 90:
      return [{ type: 'player/move', slot: 0, x: 0.5, y: -1 }];
    case 200:
      return [{ type: 'player/leave', slot: 1 }, { type: 'player/move', slot: 0, x: -1, y: -1 }];
    case 260:
      return [{ type: 'player/join', slot: 2 }, { type: 'player/move', slot: 2, x: 0, y: 1 }];
    default:
      return [];
  }
}

async function run(seed: number, ticks: number, commandsFor = script) {
  const sim = await createSimInternal({ seed });
  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick % 7 === 0) sim.rng.next();
    sim.step(commandsFor(tick));
  }
  const snapshot = sim.snapshot();
  sim.destroy();
  return snapshot;
}

describe('determinism', () => {
  it('same seed + same commands = identical state, including physics bytes', async () => {
    const a = await run(42, 400);
    const b = await run(42, 400);
    expect(a.tick).toBe(400);
    expect(a.entities.length).toBeGreaterThan(4);
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
    expect(a).toEqual(b);
    expect(a.physics).toBe(b.physics);
  });

  it('two live sims never share component data', async () => {
    const a = await createSimInternal({ seed: 1 });
    const b = await createSimInternal({ seed: 1 });
    a.step([{ type: 'player/join', slot: 0 }]);
    b.step([{ type: 'player/join', slot: 0 }]);
    a.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let i = 0; i < 30; i += 1) {
      a.step();
      b.step();
    }
    const px = (s: typeof a) => s.snapshot().entities.find((e) => e.components['Player'])?.components['Position']?.['x'];
    expect(px(a)).toBeGreaterThan(1);
    expect(px(b)).toBe(0);
    a.destroy();
    b.destroy();
  });

  it('different commands diverge', async () => {
    const a = await run(42, 120);
    const b = await run(42, 120, (tick) => (tick === 1 ? [{ type: 'player/move', slot: 0, x: -1, y: 0 }] : script(tick)));
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b));
  });

  it('different seeds diverge in the rng state', async () => {
    const a = await run(1, 30);
    const b = await run(2, 30);
    expect(a.rng).not.toBe(b.rng);
    expect(a.seed).not.toBe(b.seed);
  });
});
