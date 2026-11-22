import { readMapTiles, regions, tileOfCoordinates } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { devMapFromSettings } from './devMap';

describe('devMapFromSettings', () => {
  it('asks for no other map when nothing is set, so the world is played', () => {
    expect(devMapFromSettings({})).toBeUndefined();
  });

  it('makes a generated map of the size asked for', () => {
    const map = devMapFromSettings({ generatedMap: '400x300' });
    expect(map && readMapTiles(map).bounds).toEqual({ column: 0, row: 0, width: 400, height: 300 });
  });

  it('refuses a size it cannot read instead of quietly playing the world', () => {
    for (const size of ['', 'big', '400', '400x', '400x300x2', '-4x30', '4.5x30']) expect(() => devMapFromSettings({ generatedMap: size }), size).toThrow(/VITE_GENERATED_MAP/);
  });

  it('plays a region by its name, from the region own spawn', () => {
    expect(devMapFromSettings({ regionMap: 'alps' })).toBe(regions.alps?.map);
  });

  it('starts the walk on the walkable tile nearest to a latitude and a longitude', () => {
    const alps = regions.alps!;
    // The middle of Lake Geneva is water: the spawn lands on its shore, a few tiles away.
    const middleOfLakeGeneva = { latitude: 46.45, longitude: 6.55 };
    const map = devMapFromSettings({ regionMap: 'alps', regionSpawn: '46.45,6.55' })!;
    const asked = tileOfCoordinates(alps, middleOfLakeGeneva)!;
    expect(map.areas).toBe(alps.map.areas);
    expect(map.spawn).not.toEqual(asked);
    expect(Math.max(Math.abs(map.spawn.column - asked.column), Math.abs(map.spawn.row - asked.row))).toBeLessThan(12);
    expect(() => readMapTiles(map)).not.toThrow();
  });

  it('refuses a region it does not have, a place it cannot read, a place outside the region and two maps at once, and ignores a place when no region is played', () => {
    for (const name of ['', 'andes', 'ALPS', 'constructor', '__proto__']) expect(() => devMapFromSettings({ regionMap: name }), name).toThrow(/VITE_REGION_MAP must be one of: alps/);
    for (const spawn of ['', 'geneva', '46.2', '46.2;6.15', '46.2,6.15,3', '1e3,6', ' 46.2,6.15']) expect(() => devMapFromSettings({ regionMap: 'alps', regionSpawn: spawn }), spawn).toThrow(/\?at= must be a latitude and a longitude/);
    expect(() => devMapFromSettings({ regionMap: 'alps', regionSpawn: '10,10' })).toThrow(/outside the region/);
    expect(devMapFromSettings({ regionSpawn: '46.2,6.15' })).toBeUndefined();
    expect(() => devMapFromSettings({ generatedMap: '40x30', regionMap: 'alps' })).toThrow(/set one/);
  });
});
