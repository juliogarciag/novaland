import {
  CHUNK_SIZE,
  EDGE_SHAPES,
  EdgeNeighbour,
  getTileDef,
  NO_TILE,
  readMapTiles,
  tileDefIdAt,
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
  GROUND_TILESET_COLUMNS,
  groundTileIndexRows,
  groundTilesetCellOf,
  groundTilesetSizeOf,
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
      ["water", 8 + EDGE_SHAPES.length],
      ["shallows", 8 + EDGE_SHAPES.length],
    ]);
    expect(slots.map((slot) => [slot.def.name, slot.variantCount])).toEqual([
      ["grass", 24],
      ["dirt", 1],
      ["tree", 1],
      ["rock", 1],
      ["water", 8],
      ["shallows", 8],
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
    const otherSize: TileDef = {
      ...grass,
      groundSprite: { ...grass.groundSprite!, tilePixels: GROUND_TILE_PIXELS / 2 },
    };
    expect(() => groundTilesetSlots([otherSize], everythingLoaded)).toThrow(
      new RegExp(`${GROUND_TILE_PIXELS / 2}-pixel tiles`),
    );
  });
});

describe("the ground tileset's rows", () => {
  it("holds every tile of the terrain defs in a texture no side of which passes 4096 pixels", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const tileCount = slots.reduce((count, slot) => count + slot.tileCount, 0);
    const { columns, rows } = groundTilesetSizeOf(tileCount);
    expect(columns * rows).toBeGreaterThanOrEqual(tileCount);
    expect(columns * GROUND_TILE_PIXELS).toBeLessThanOrEqual(4096);
    expect(rows * GROUND_TILE_PIXELS).toBeLessThanOrEqual(4096);
  });

  it("puts tiles left to right, then on the next row, the order a tileset counts them in, each in a cell of its own", () => {
    expect(groundTilesetCellOf(0)).toEqual({ column: 0, row: 0 });
    expect(groundTilesetCellOf(GROUND_TILESET_COLUMNS - 1)).toEqual({ column: GROUND_TILESET_COLUMNS - 1, row: 0 });
    expect(groundTilesetCellOf(GROUND_TILESET_COLUMNS)).toEqual({ column: 0, row: 1 });
    const tileCount = 3 * GROUND_TILESET_COLUMNS + 5;
    const { columns, rows } = groundTilesetSizeOf(tileCount);
    const cells = new Set<string>();
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const { column, row } = groundTilesetCellOf(tileIndex);
      expect(row * columns + column).toBe(tileIndex);
      expect(row).toBeLessThan(rows);
      cells.add(`${column},${row}`);
    }
    expect(cells.size).toBe(tileCount);
  });

  it("is one row, no wider than its tiles, while they fit in one", () => {
    expect(groundTilesetSizeOf(5)).toEqual({ columns: 5, rows: 1 });
    expect(groundTilesetSizeOf(GROUND_TILESET_COLUMNS)).toEqual({ columns: GROUND_TILESET_COLUMNS, rows: 1 });
  });
});

describe("groundTileIndexRows", () => {
  it("shows every grass tile in the variant its world column and row pick, wherever its chunk is", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, "grass");
    for (const origin of [{ column: 0, row: 0 }, { column: -70, row: 45 }]) {
      const chunk = chunkOf(["....", "....", "...."], origin);
      const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround });
      for (let row = origin.row; row < origin.row + 3; row += 1) {
        for (let column = origin.column; column < origin.column + 4; column += 1) {
          expect(rows[row - chunk.firstTile.row]![column - chunk.firstTile.column]).toBe(
            grass.firstTileIndex + variantOfTile({ column, row, variantCount: grass.variantCount }),
          );
        }
      }
    }
  });

  it("is a full chunk of rows, empty where no area put a tile", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const rows = groundTileIndexRows({ chunk: chunkOf(["..", ".."]), slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround });
    expect(rows).toHaveLength(CHUNK_SIZE);
    for (const indices of rows) expect(indices).toHaveLength(CHUNK_SIZE);
    expect(rows.flat().filter((tileIndex) => tileIndex !== EMPTY_GROUND_TILE)).toHaveLength(4);
    expect(rows[0]![2]).toBe(EMPTY_GROUND_TILE);
    expect(rows[2]![0]).toBe(EMPTY_GROUND_TILE);
  });

  it("puts the grass a tile would have had under a tree or a rock", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const withThings = groundTileIndexRows({ chunk: chunkOf(["T.o", ".o.", ".TT"]), slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround });
    const allGrass = groundTileIndexRows({ chunk: chunkOf(["...", "...", "..."]), slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround });
    expect(withThings).toEqual(allGrass);
  });

  it("shows a flat tile without a sprite as its one tile", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const rows = groundTileIndexRows({ chunk: chunkOf([".==="]), slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround });
    expect(rows[0]!.slice(1, 4)).toEqual([1, 2, 3].map(() => slotOf(slots, "dirt").firstTileIndex));
  });

  it("draws a standing tile flat in its own tile when its image did not load, and still textures the grass", () => {
    const treeMissing = (key: string): boolean => key !== "tree";
    const slots = groundTilesetSlots(terrainDefs, treeMissing);
    const rows = groundTileIndexRows({ chunk: chunkOf(["T.o"]), slots, isStandingImageDrawn: (sprite) => treeMissing(sprite.key), defIdAt: nothingAround });
    const grass = slotOf(slots, "grass");
    expect(rows[0]![0]).toBe(slotOf(slots, "tree").firstTileIndex);
    expect(rows[0]![1]).toBe(grass.firstTileIndex + variantOfTile({ column: 1, row: 0, variantCount: grass.variantCount }));
    expect(rows[0]![2]).toBe(grass.firstTileIndex + variantOfTile({ column: 2, row: 0, variantCount: grass.variantCount }));
  });

  it("with no sheet loaded at all, every tile is the flat tile of its own def, as before there was art", () => {
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    for (const chunk of readMapTiles(worldMap).chunks) {
      const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: nothingLoaded, defIdAt: nothingAround });
      expect(rows.flat()).toEqual(Array.from(chunk.defIds, (defId) => (defId === NO_TILE ? EMPTY_GROUND_TILE : terrainDefs.findIndex((def) => def.id === defId))));
    }
  });

  it("shows the edge tile of its shape where a surface ends: the shallows against the land, deep water against the shallows", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const chunk = chunkOf([".....", ".---.", ".-~-.", ".---.", "....."]);
    const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: defIdIn(chunk) });
    const edgeTileOf = (name: string, shape: number): number => slotOf(slots, name).firstTileIndex + slotOf(slots, name).variantCount + EDGE_SHAPES.indexOf(shape);
    // Deep water with shallows all round: nothing beside it is deep water.
    expect(rows[2]![2]).toBe(edgeTileOf("water", 0));
    // The north-west corner of the lake: water to the east, the south and between them.
    expect(rows[1]![1]).toBe(edgeTileOf("shallows", EdgeNeighbour.East | EdgeNeighbour.South | EdgeNeighbour.SouthEast));
    // The middle of its north side: land to the north only.
    expect(rows[1]![2]).toBe(edgeTileOf("shallows", EdgeNeighbour.East | EdgeNeighbour.South | EdgeNeighbour.West | EdgeNeighbour.SouthEast | EdgeNeighbour.SouthWest));
    // Its south-east corner.
    expect(rows[3]![3]).toBe(edgeTileOf("shallows", EdgeNeighbour.North | EdgeNeighbour.West | EdgeNeighbour.NorthWest));
    // The land is drawn as ever.
    const grass = slotOf(slots, "grass");
    expect(rows[0]![0]).toBe(grass.firstTileIndex + variantOfTile({ column: 0, row: 0, variantCount: grass.variantCount }));
  });

  it("shows a variant where every tile around is the same surface, the tiles of the chunks next door included", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const chunk = chunkOf(["-------", "-------", "--~~~--", "--~~~--", "--~~~--", "-------", "-------", "......."]);
    const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: defIdIn(chunk) });
    const variantOf = (name: string, tile: TileCoordinate): number => slotOf(slots, name).firstTileIndex + variantOfTile({ ...tile, variantCount: slotOf(slots, name).variantCount });
    expect(rows[3]![3]).toBe(variantOf("water", { column: 3, row: 3 }));
    expect(rows[1]![1]).toBe(variantOf("shallows", { column: 1, row: 1 }));
    // The tile in the chunk's corner has the map's end on two sides: an edge. With water in the chunks next door it has none.
    expect(rows[0]![0]).not.toBe(variantOf("shallows", { column: 0, row: 0 }));
    const amongWater = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: (tile) => defIdIn(chunk)(tile) ?? idOf("shallows") });
    expect(amongWater[0]![0]).toBe(variantOf("shallows", { column: 0, row: 0 }));
  });

  it("draws no edges on a surface whose sheet did not load: the lake is flat tiles", () => {
    const slots = groundTilesetSlots(terrainDefs, nothingLoaded);
    const chunk = chunkOf([".....", ".---.", ".-~-.", ".---.", "....."]);
    const rows = groundTileIndexRows({ chunk, slots, isStandingImageDrawn: nothingLoaded, defIdAt: defIdIn(chunk) });
    expect(rows[2]!.slice(0, 5)).toEqual(["grass", "shallows", "water", "shallows", "grass"].map((name) => slotOf(slots, name).firstTileIndex));
  });

  it("draws the coasts of the world with many edge tiles: straight sides and corners both ways, not the few a rectangle would use", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const tiles = readMapTiles(worldMap);
    const shallows = slotOf(slots, "shallows");
    const used = new Set(tiles.chunks.flatMap((chunk) => groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: (tile) => tileDefIdAt(tiles, tile) }).flat()));
    const shallowsTilesUsed = [...used].filter((tileIndex) => tileIndex >= shallows.firstTileIndex && tileIndex < shallows.firstTileIndex + shallows.tileCount);
    // Straight sides, corners both ways: a lake that only ever used a few would be a rectangle.
    expect(shallowsTilesUsed.filter((tileIndex) => tileIndex >= shallows.firstTileIndex + shallows.variantCount).length).toBeGreaterThanOrEqual(8);
  });

  it("uses every grass variant somewhere in the world", () => {
    const slots = groundTilesetSlots(terrainDefs, everythingLoaded);
    const grass = slotOf(slots, "grass");
    const used = new Set(readMapTiles(worldMap).chunks.flatMap((chunk) => groundTileIndexRows({ chunk, slots, isStandingImageDrawn: everythingLoaded, defIdAt: nothingAround }).flat()));
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

/** For a chunk drawn alone: no tile anywhere around it. */
function nothingAround(): undefined {
  return undefined;
}

/** What is at a world tile for a map that is this one chunk. */
function defIdIn(chunk: MapChunk): (tile: TileCoordinate) => number | undefined {
  return ({ column, row }) => {
    const localColumn = column - chunk.firstTile.column;
    const localRow = row - chunk.firstTile.row;
    if (localColumn < 0 || localRow < 0 || localColumn >= CHUNK_SIZE || localRow >= CHUNK_SIZE) return undefined;
    const defId = chunk.defIds[localRow * CHUNK_SIZE + localColumn] as number;
    return defId === NO_TILE ? undefined : defId;
  };
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
  const legend = { T: idOf("tree"), ".": idOf("grass"), "=": idOf("dirt"), o: idOf("rock"), "~": idOf("water"), "-": idOf("shallows") };
  const { chunks } = readMapTiles({ areas: [{ name: "test", origin, legend, rows }], spawn });
  if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.length}`);
  return chunks[0]!;
}
