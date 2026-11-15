import {
  CHUNK_SIZE,
  getTileDef,
  NO_TILE,
  readMapTiles,
  terrainDefs,
  worldMap,
  type MapChunk,
  type TileCoordinate,
  type TileDef,
} from "@novaland/sim";
import { describe, expect, it } from "vitest";
import {
  EMPTY_GROUND_TILE,
  GROUND_TILE_PIXELS,
  groundTileIndexRows,
  groundTilesetSlots,
} from "./groundTiles";
import { variantOfTile } from "./tileVariant";

describe("groundTilesetSlots", () => {
  it("gives a def with a loaded ground sprite one tile per variant and every other def one flat tile, end to end in def order", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    expect(slots.map((slot) => slot.def)).toEqual(terrainDefs);
    let nextTileIndex = 0;
    for (const slot of slots) {
      expect(slot.firstTileIndex, slot.def.name).toBe(nextTileIndex);
      expect(slot.groundSprite, slot.def.name).toBe(slot.def.groundSprite);
      nextTileIndex += slot.tileCount;
    }
    expect(slots.map((slot) => [slot.def.name, slot.tileCount])).toEqual([
      ["grass", 24],
      ["dirt", 1],
      ["tree", 1],
      ["rock", 1],
      ["water", 8],
    ]);
  });

  it("falls back to one flat tile for a ground sprite whose sheet did not load", () => {
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    expect(
      slots.map((slot) => [
        slot.firstTileIndex,
        slot.tileCount,
        slot.groundSprite,
      ]),
    ).toEqual(terrainDefs.map((_, index) => [index, 1, undefined]));
  });

  it("every ground sprite of the terrain defs has tiles of the size the tileset is built from", () => {
    for (const def of terrainDefs) {
      if (def.groundSprite)
        expect(def.groundSprite.tilePixels, def.name).toBe(GROUND_TILE_PIXELS);
    }
  });

  it("refuses a ground sprite whose tiles are another size", () => {
    const grass = getTileDef(idOf("grass"));
    const oversized: TileDef = {
      ...grass,
      groundSprite: { ...grass.groundSprite!, tilePixels: 32 },
    };
    expect(() => groundTilesetSlots([oversized], everythingLoaded)).toThrow(
      /32-pixel tiles/,
    );
  });
});

describe("groundTileIndexRows", () => {
  it("shows every grass tile in the variant its world column and row pick, wherever its chunk is", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, "grass");
    for (const origin of [{ column: 0, row: 0 }, { column: -70, row: 45 }]) {
      const chunk = chunkOf(["....", "....", "...."], origin);
      const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded });
      for (let row = origin.row; row < origin.row + 3; row += 1) {
        for (let column = origin.column; column < origin.column + 4; column += 1) {
          expect(rows[row - chunk.firstTile.row]![column - chunk.firstTile.column]).toBe(
            grass.firstTileIndex + variantOfTile({ column, row, variantCount: grass.tileCount }),
          );
        }
      }
    }
  });

  it("is a full chunk of rows, empty where no area put a tile", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const rows = groundTileIndexRows({ chunk: chunkOf(["..", ".."]), slots, isStandingImageDrawn: everythingLoaded });
    expect(rows).toHaveLength(CHUNK_SIZE);
    for (const indices of rows) expect(indices).toHaveLength(CHUNK_SIZE);
    expect(rows.flat().filter((tileIndex) => tileIndex !== EMPTY_GROUND_TILE)).toHaveLength(4);
    expect(rows[0]![2]).toBe(EMPTY_GROUND_TILE);
    expect(rows[2]![0]).toBe(EMPTY_GROUND_TILE);
  });

  it("puts the grass a tile would have had under a tree or a rock", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const withThings = groundTileIndexRows({ chunk: chunkOf(["T.o", ".o.", ".TT"]), slots, isStandingImageDrawn: everythingLoaded });
    const allGrass = groundTileIndexRows({ chunk: chunkOf(["...", "...", "..."]), slots, isStandingImageDrawn: everythingLoaded });
    expect(withThings).toEqual(allGrass);
  });

  it("shows a flat tile without a sprite as its one tile", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const rows = groundTileIndexRows({ chunk: chunkOf([".==="]), slots, isStandingImageDrawn: everythingLoaded });
    expect(rows[0]!.slice(1, 4)).toEqual([1, 2, 3].map(() => slotOf(slots, "dirt").firstTileIndex));
  });

  it("draws a standing tile flat in its own tile when its image did not load, and still textures the grass", () => {
    const treeMissing = (key: string): boolean => key !== "tree";
    const slots = groundTilesetSlots(terrainDefs, treeMissing);
    const rows = groundTileIndexRows({ chunk: chunkOf(["T.o"]), slots, isStandingImageDrawn: (sprite) => treeMissing(sprite.key) });
    const grass = slotOf(slots, "grass");
    expect(rows[0]![0]).toBe(slotOf(slots, "tree").firstTileIndex);
    expect(rows[0]![1]).toBe(grass.firstTileIndex + variantOfTile({ column: 1, row: 0, variantCount: grass.tileCount }));
    expect(rows[0]![2]).toBe(grass.firstTileIndex + variantOfTile({ column: 2, row: 0, variantCount: grass.tileCount }));
  });

  it("with no sheet loaded at all, every tile is the flat tile of its own def, as before there was art", () => {
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    for (const chunk of readMapTiles(worldMap).chunks) {
      const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: nothingLoaded });
      expect(rows.flat()).toEqual(Array.from(chunk.defIds, (defId) => (defId === NO_TILE ? EMPTY_GROUND_TILE : terrainDefs.findIndex((def) => def.id === defId))));
    }
  });

  it("uses every grass variant somewhere in the world", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, "grass");
    const used = new Set(readMapTiles(worldMap).chunks.flatMap((chunk) => groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded }).flat()));
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

function slotOf(
  slots: ReturnType<typeof groundTilesetSlots>,
  name: string,
): ReturnType<typeof groundTilesetSlots>[number] {
  const slot = slots.find((candidate) => candidate.def.name === name);
  if (!slot) throw new Error(`There is no slot for ${name}`);
  return slot;
}

/** The one chunk of a map made of these rows, mounted at `origin`. */
function chunkOf(rows: string[], origin: TileCoordinate = { column: 0, row: 0 }): MapChunk {
  const spawnRow = rows.findIndex((row) => /[.=]/.test(row));
  const spawn = { column: origin.column + rows[spawnRow]!.search(/[.=]/), row: origin.row + spawnRow };
  const legend = { T: idOf("tree"), ".": idOf("grass"), "=": idOf("dirt"), o: idOf("rock") };
  const { chunks } = readMapTiles({ areas: [{ name: "test", origin, legend, rows }], spawn });
  if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.length}`);
  return chunks[0]!;
}
