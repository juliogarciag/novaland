import { describe, expect, it } from 'vitest';
import { __testing__, loadNameFont } from './nameLabel';

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

describe('waiting for the name font', () => {
  it('loads every face of the name font and no other', async () => {
    const faces = [fakeFace('Tiny5'), fakeFace('"Tiny5"'), fakeFace('Other')];
    await loadNameFont(fontSetOf(faces));
    expect(faces.map((face) => face.loads)).toEqual([1, 1, 0]);
  });

  it('resolves when a face cannot be loaded: names then draw in the fallback font', async () => {
    const faces = [fakeFace('Tiny5', { fails: true }), fakeFace('Tiny5')];
    await expect(loadNameFont(fontSetOf(faces))).resolves.toBeUndefined();
    expect(faces[1].loads).toBe(1);
  });
});

// ---- Helpers ----

interface FakeFace {
  readonly family: string;
  loads: number;
  load(): Promise<void>;
}

function fakeFace(family: string, { fails = false } = {}): FakeFace {
  return {
    family,
    loads: 0,
    load() {
      this.loads += 1;
      return fails ? Promise.reject(new Error('no font')) : Promise.resolve();
    },
  };
}

function fontSetOf(faces: readonly FakeFace[]): FontFaceSet {
  return faces as unknown as FontFaceSet;
}

const { scaleWithinWidth } = __testing__;
