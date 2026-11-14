import { describe, expect, it } from "vitest";
import { variantOfTile } from "./tileVariant";

describe("variantOfTile", () => {
  it("gives a tile the variant it has always had: a changed hash would redraw every tree, rock and grass tile", () => {
    const variants = [
      [0, 0],
      [7, 3],
      [20, 14],
      [39, 29],
    ].map(([column, row]) =>
      [3, 4, 24].map((variantCount) =>
        variantOfTile({ column: column!, row: row!, variantCount }),
      ),
    );
    expect(variants).toEqual(PINNED_VARIANTS);
  });

  it("uses every variant about as often across a level, however many there are", () => {
    for (const variantCount of [3, 4, 24]) {
      const counts = Array.from({ length: variantCount }, () => 0);
      for (let row = 0; row < 30; row += 1) {
        for (let column = 0; column < 40; column += 1)
          counts[variantOfTile({ column, row, variantCount })]! += 1;
      }
      const evenShare = (30 * 40) / variantCount;
      for (const count of counts)
        expect(count, `${variantCount} variants`).toBeGreaterThan(
          evenShare * 0.6,
        );
    }
  });

  it("does not paint whole rows or columns in one variant", () => {
    for (let line = 0; line < 30; line += 1) {
      expect(
        new Set(
          Array.from({ length: 30 }, (_, index) =>
            variantOfTile({ column: index, row: line, variantCount: 3 }),
          ),
        ).size,
      ).toBeGreaterThan(1);
      expect(
        new Set(
          Array.from({ length: 30 }, (_, index) =>
            variantOfTile({ column: line, row: index, variantCount: 3 }),
          ),
        ).size,
      ).toBeGreaterThan(1);
    }
  });

  it("picks the only variant there is when there is one", () => {
    expect(variantOfTile({ column: 12, row: 5, variantCount: 1 })).toBe(0);
  });
});

// ---- Helpers ----

/** For tiles (0,0), (7,3), (20,14) and (39,29): the variant picked out of 3, 4 and 24. */
const PINNED_VARIANTS = [
  [0, 0, 0],
  [0, 3, 15],
  [0, 2, 6],
  [2, 1, 17],
];
