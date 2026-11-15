import { describe, expect, it } from 'vitest';
import { __testing__ } from './nameLabel';

describe('the width a name may draw', () => {
  it('leaves a name that fits at its own size', () => {
    expect(scaleWithinWidth({ width: 120, widest: 240 })).toBe(1);
    expect(scaleWithinWidth({ width: 240, widest: 240 })).toBe(1);
    expect(scaleWithinWidth({ width: 0, widest: 240 })).toBe(1);
  });

  it('shrinks a wider one to exactly the widest allowed', () => {
    // Twenty very wide glyphs measured about four times the limit.
    const scale = scaleWithinWidth({ width: 966, widest: 240 });
    expect(scale).toBeLessThan(1);
    expect(966 * scale).toBeCloseTo(240);
  });
});

// ---- Helpers ----

const { scaleWithinWidth } = __testing__;
