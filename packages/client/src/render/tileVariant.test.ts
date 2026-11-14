import { describe, expect, it } from 'vitest';
import { variantOfTile } from './tileVariant';

describe('variantOfTile', () => {
  it('gives a tile the same variant every time', () => {
    expect(variantOfTile({ column: 7, row: 3, variantCount: 3 })).toBe(variantOfTile({ column: 7, row: 3, variantCount: 3 }));
  });

  it('uses every variant about as often across a level, however many there are', () => {
    for (const variantCount of [3, 4, 24]) {
      const counts = Array.from({ length: variantCount }, () => 0);
      for (let row = 0; row < 30; row += 1) {
        for (let column = 0; column < 40; column += 1) counts[variantOfTile({ column, row, variantCount })]! += 1;
      }
      const evenShare = (30 * 40) / variantCount;
      for (const count of counts) expect(count, `${variantCount} variants`).toBeGreaterThan(evenShare * 0.6);
    }
  });

  it('does not paint whole rows or columns in one variant', () => {
    for (let line = 0; line < 30; line += 1) {
      expect(new Set(Array.from({ length: 30 }, (_, index) => variantOfTile({ column: index, row: line, variantCount: 3 }))).size).toBeGreaterThan(1);
      expect(new Set(Array.from({ length: 30 }, (_, index) => variantOfTile({ column: line, row: index, variantCount: 3 }))).size).toBeGreaterThan(1);
    }
  });

  it('picks the only variant there is when there is one', () => {
    expect(variantOfTile({ column: 12, row: 5, variantCount: 1 })).toBe(0);
  });
});
