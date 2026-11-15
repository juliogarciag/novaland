import { describe, expect, it } from 'vitest';
import { EDGE_SHAPES, EdgeNeighbour, edgeShapeOf } from './defs';

describe('edge shapes', () => {
  it('keeps the four sides as they are', () => {
    for (const side of [EdgeNeighbour.North, EdgeNeighbour.East, EdgeNeighbour.South, EdgeNeighbour.West]) expect(edgeShapeOf(side)).toBe(side);
    expect(edgeShapeOf(0)).toBe(0);
  });

  it('drops a diagonal neighbour unless both tiles beside it are the same surface too', () => {
    expect(edgeShapeOf(EdgeNeighbour.NorthEast)).toBe(0);
    expect(edgeShapeOf(EdgeNeighbour.North | EdgeNeighbour.NorthEast)).toBe(EdgeNeighbour.North);
    expect(edgeShapeOf(EdgeNeighbour.East | EdgeNeighbour.NorthEast)).toBe(EdgeNeighbour.East);
    const corner = EdgeNeighbour.North | EdgeNeighbour.East | EdgeNeighbour.NorthEast;
    expect(edgeShapeOf(corner)).toBe(corner);
    expect(edgeShapeOf(corner | EdgeNeighbour.SouthWest)).toBe(corner);
  });

  it('gives a tile with the same surface all round the one shape that has no edge', () => {
    expect(edgeShapeOf(255)).toBe(255);
    expect(EDGE_SHAPES).not.toContain(255);
  });

  it('lists the 46 shapes with an edge once each, in rising order: a sheet holds its edge tiles in this order', () => {
    expect(EDGE_SHAPES).toHaveLength(46);
    expect(new Set(EDGE_SHAPES).size).toBe(46);
    expect([...EDGE_SHAPES].sort((first, second) => first - second)).toEqual(EDGE_SHAPES);
    expect(EDGE_SHAPES.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('has a place in the list for the shape of every neighbourhood but the one with no edge', () => {
    for (let neighbours = 0; neighbours < 255; neighbours += 1) expect(EDGE_SHAPES, `neighbours ${neighbours}`).toContain(edgeShapeOf(neighbours));
  });
});
