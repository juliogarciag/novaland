import { terrainDefs } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { FRAME_HEIGHT, FRAME_WIDTH, TREE_SPRITE_KEY, TREE_VARIANT_COUNT, paintTreeSheet } from './generate-tree-sheet.mjs';

describe('tree sheet generator', () => {
  it('paints the sheet under the key and in the frame layout the tree def declares', () => {
    const standingSprite = terrainDefs.find((def) => def.name === 'tree')?.standingSprite;
    expect(standingSprite).toMatchObject({ key: TREE_SPRITE_KEY, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT, variantCount: TREE_VARIANT_COUNT });
    const sheet = paintTreeSheet();
    expect([sheet.width, sheet.height]).toEqual([FRAME_WIDTH * TREE_VARIANT_COUNT, FRAME_HEIGHT]);
  });

  it('paints the same sheet every time', () => {
    expect(paintTreeSheet().data).toEqual(paintTreeSheet().data);
  });
});
