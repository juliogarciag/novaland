import { generatedWorldMap, regionMapSpawningNear, regions, type WorldMap } from '@novaland/sim';

/** The settings of a dev build that swap the world for another map, as they come from the environment. */
export interface DevMapSettings {
  /** `VITE_GENERATED_MAP`: a size such as "400x300". */
  readonly generatedMap?: string | undefined;
  /** `VITE_REGION_MAP`: the name of a region, such as "alps". */
  readonly regionMap?: string | undefined;
  /** `?at=` in the page's address, read only with a region: a latitude and a longitude in degrees, such as "46.2,6.15", to start the walk there. */
  readonly regionSpawn?: string | undefined;
}

/**
 * The map a dev build plays solo instead of the world, or undefined when no
 * setting asks for one: a generated map of a size, to measure how the
 * client copes with a big one, or a region of the real Earth, to walk it
 * from its own spawn or from the place `regionSpawn` names.
 * Throws for a setting it cannot read: playing the world when another map
 * was asked for would be mistaken for it.
 */
export function devMapFromSettings({ generatedMap, regionMap, regionSpawn }: DevMapSettings): WorldMap | undefined {
  if (generatedMap !== undefined && regionMap !== undefined) throw new Error('VITE_GENERATED_MAP and VITE_REGION_MAP are two different maps: set one');
  if (generatedMap !== undefined) return generatedMapOfSize(generatedMap);
  if (regionMap === undefined) return undefined;
  const region = Object.hasOwn(regions, regionMap) ? regions[regionMap] : undefined;
  if (!region) throw new Error(`VITE_REGION_MAP must be one of: ${Object.keys(regions).join(', ')}; got "${regionMap}"`);
  if (regionSpawn === undefined) return region.map;
  const match = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(regionSpawn);
  if (!match) throw new Error(`?at= must be a latitude and a longitude such as ?at=46.2,6.15; got "${regionSpawn}"`);
  return regionMapSpawningNear(region, { latitude: Number(match[1]), longitude: Number(match[2]) });
}

function generatedMapOfSize(size: string): WorldMap {
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(size);
  if (!match) throw new Error(`VITE_GENERATED_MAP must look like 400x300, got "${size}"`);
  return generatedWorldMap({ columns: Number(match[1]), rows: Number(match[2]) });
}
