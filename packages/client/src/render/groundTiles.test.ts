import { getTileDef, readTileGrid, starterLevel, terrainDefs, type LevelData, type TileDef } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { GROUND_TILE_PIXELS, groundTileIndexRows, groundTilesetSlots } from './groundTiles';
import { variantOfTile } from './tileVariant';

describe('groundTilesetSlots', () => {
  it('gives a def with a loaded ground sprite one tile per variant and every other def one flat tile, end to end in def order', () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    expect(slots.map((slot) => slot.def)).toEqual(terrainDefs);
    let nextTileIndex = 0;
    for (const slot of slots) {
      expect(slot.firstTileIndex, slot.def.name).toBe(nextTileIndex);
      expect(slot.tileCount, slot.def.name).toBe(slot.def.groundSprite?.variantCount ?? 1);
      expect(slot.groundSprite, slot.def.name).toBe(slot.def.groundSprite);
      nextTileIndex += slot.tileCount;
    }
    expect(slotOf(slots, 'grass').tileCount).toBeGreaterThan(1);
  });

  it('falls back to one flat tile for a ground sprite whose sheet did not load', () => {
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    expect(slots.map((slot) => [slot.firstTileIndex, slot.tileCount, slot.groundSprite])).toEqual(terrainDefs.map((_, index) => [index, 1, undefined]));
  });

  it('every ground sprite of the terrain defs has tiles of the size the tileset is built from', () => {
    for (const def of terrainDefs) {
      if (def.groundSprite) expect(def.groundSprite.tilePixels, def.name).toBe(GROUND_TILE_PIXELS);
    }
  });

  it('refuses a ground sprite whose tiles are another size', () => {
    const grass = getTileDef(idOf('grass'));
    const oversized: TileDef = { ...grass, groundSprite: { ...grass.groundSprite!, tilePixels: 32 } };
    expect(() => groundTilesetSlots([oversized], everythingLoaded)).toThrow(/32-pixel tiles/);
  });
});

describe('groundTileIndexRows', () => {
  it('shows every grass tile in the variant its column and row pick', () => {
    const grid = readTileGrid(level(['....', '....', '....']));
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, 'grass');
    const rows = groundTileIndexRows({ grid, slots, isTextureLoaded: everythingLoaded });
    rows.forEach((indices, row) =>
      indices.forEach((tileIndex, column) => {
        expect(tileIndex).toBe(grass.firstTileIndex + variantOfTile({ column, row, variantCount: grass.tileCount }));
      }),
    );
  });

  it('puts the grass a tile would have had under a tree or a rock', () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const withThings = groundTileIndexRows({ grid: readTileGrid(level(['T.o', '.o.', '.TT'])), slots, isTextureLoaded: everythingLoaded });
    const allGrass = groundTileIndexRows({ grid: readTileGrid(level(['...', '...', '...'])), slots, isTextureLoaded: everythingLoaded });
    expect(withThings).toEqual(allGrass);
  });

  it('shows a flat tile without a sprite as its one tile', () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const rows = groundTileIndexRows({ grid: readTileGrid(level(['.==='])), slots, isTextureLoaded: everythingLoaded });
    expect(rows[0]!.slice(1)).toEqual([1, 2, 3].map(() => slotOf(slots, 'dirt').firstTileIndex));
  });

  it('draws a standing tile flat in its own tile when its image did not load, and still textures the grass', () => {
    const treeMissing = (key: string): boolean => key !== 'tree';
    const slots = groundTilesetSlots(terrainDefs, treeMissing);
    const rows = groundTileIndexRows({ grid: readTileGrid(level(['T.o'])), slots, isTextureLoaded: treeMissing });
    const grass = slotOf(slots, 'grass');
    expect(rows[0]![0]).toBe(slotOf(slots, 'tree').firstTileIndex);
    expect(rows[0]![1]).toBe(grass.firstTileIndex + variantOfTile({ column: 1, row: 0, variantCount: grass.tileCount }));
    expect(rows[0]![2]).toBe(grass.firstTileIndex + variantOfTile({ column: 2, row: 0, variantCount: grass.tileCount }));
  });

  it('with no sheet loaded at all, every tile is the flat tile of its own def, as before there was art', () => {
    const grid = readTileGrid(starterLevel);
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    const rows = groundTileIndexRows({ grid, slots, isTextureLoaded: nothingLoaded });
    expect(rows).toEqual(grid.defIds.map((defIds) => defIds.map((defId) => terrainDefs.findIndex((def) => def.id === defId))));
  });

  it('uses every grass variant somewhere in the starter level', () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, 'grass');
    const used = new Set(groundTileIndexRows({ grid: readTileGrid(starterLevel), slots, isTextureLoaded: everythingLoaded }).flat());
    for (let variant = 0; variant < grass.tileCount; variant += 1) expect(used.has(grass.firstTileIndex + variant), `variant ${variant}`).toBe(true);
  });
});

// ---- Helpers ----

function everythingLoaded(): boolean {
  return true;
}

function nothingLoaded(): boolean {
  return false;
}

function idOf(name: string): number {
  const def = terrainDefs.find((candidate) => candidate.name === name);
  if (!def) throw new Error(`There is no ${name} def`);
  return def.id;
}

function slotOf(slots: ReturnType<typeof groundTilesetSlots>, name: string): ReturnType<typeof groundTilesetSlots>[number] {
  const slot = slots.find((candidate) => candidate.def.name === name);
  if (!slot) throw new Error(`There is no slot for ${name}`);
  return slot;
}

/** A level of these rows; the spawn is its first walkable tile, as a level must have one. */
function level(rows: string[]): LevelData {
  const spawnRow = rows.findIndex((row) => /[.=]/.test(row));
  const spawn = { column: rows[spawnRow]!.search(/[.=]/), row: spawnRow };
  return { name: 'test', legend: { T: idOf('tree'), '.': idOf('grass'), '=': idOf('dirt'), o: idOf('rock') }, rows, spawn };
}
