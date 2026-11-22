/**
 * What a tile of a region can be, and the rule that picks one from what the
 * datasets say about the ground it covers.
 *
 * Seen from above, height is read from colour bands: open ground goes from
 * grass through upland and alpine meadow to scree as it climbs, forest has
 * a lowland and a mountain shade, and the highest ground is summit or
 * glacier, which nobody walks on. The bands are in metres above the sea.
 */
import { LandCover } from './sources.mjs';

/**
 * Every kind of tile, with the character it is written as in the map's rows
 * and the name of its def in `TerrainDefId` (packages/sim/src/features/terrain/defs.ts).
 * `solid` repeats the def's flag, which the script needs to place rivers
 * and the spawn; a test of the script (region.test.mjs) fails if the two disagree.
 */
export const TILE_KINDS = [
  { name: 'grass', character: '.', defName: 'Grass', solid: false },
  { name: 'forest', character: 'f', defName: 'Forest', solid: false },
  { name: 'mountainForest', character: 'F', defName: 'MountainForest', solid: false },
  { name: 'upland', character: 'u', defName: 'Upland', solid: false },
  { name: 'alpineMeadow', character: 'a', defName: 'AlpineMeadow', solid: false },
  { name: 'scree', character: 's', defName: 'Scree', solid: false },
  { name: 'summit', character: 'A', defName: 'Summit', solid: true },
  { name: 'glacier', character: 'G', defName: 'Glacier', solid: true },
  { name: 'marsh', character: 'm', defName: 'Marsh', solid: false },
  { name: 'river', character: 'r', defName: 'River', solid: false },
  { name: 'water', character: '~', defName: 'Water', solid: true },
  { name: 'shallows', character: '-', defName: 'Shallows', solid: true },
];

export const kindIndexByName = Object.fromEntries(TILE_KINDS.map((kind, index) => [kind.name, index]));

/** Where each band of height starts, in metres above the sea. */
const HeightBand = {
  /** Open ground below this is grass: the plains and the floors of the big valleys. */
  Upland: 500,
  /** Forest from here up is mountain forest. */
  MountainForest: 1000,
  /** Open ground from here up is alpine meadow: above the farms, around the tree line. */
  AlpineMeadow: 1500,
  /** Open ground from here up is scree, whatever grows on it. */
  Scree: 2300,
  /** A tile whose mean height reaches this is a summit: rock nobody walks over. */
  Summit: 2800,
};

/** The groups of land cover a tile is decided by. Each sample of the land cover raster falls in one. */
export const COVER_GROUPS = ['water', 'trees', 'snowAndIce', 'bare', 'wetland', 'open'];

const coverGroupByClass = new Map([
  [LandCover.NoData, 'water'],
  [LandCover.Water, 'water'],
  [LandCover.Trees, 'trees'],
  [LandCover.Mangroves, 'trees'],
  [LandCover.SnowAndIce, 'snowAndIce'],
  [LandCover.Bare, 'bare'],
  [LandCover.MossAndLichen, 'bare'],
  [LandCover.Wetland, 'wetland'],
  // Farmland and towns are people's work: the world shows the open ground they stand on.
  [LandCover.Shrubland, 'open'],
  [LandCover.Grassland, 'open'],
  [LandCover.Cropland, 'open'],
  [LandCover.BuiltUp, 'open'],
]);

/** The index in `COVER_GROUPS` of a land cover class, or undefined for a value the dataset does not define. */
export function coverGroupIndexOf(landCoverClass) {
  const group = coverGroupByClass.get(landCoverClass);
  return group === undefined ? undefined : COVER_GROUPS.indexOf(group);
}

/**
 * The kind of a tile, by name, from the land cover samples that fell in it
 * (`coverCounts`, one count per group of `COVER_GROUPS`) and its mean height
 * in metres. The most common cover decides; ties go to the group listed
 * first. A tile no sample fell in is open sea, which the datasets leave out.
 */
export function kindOfTile({ coverCounts, meanElevation }) {
  let mostCommon = 0;
  for (let index = 1; index < coverCounts.length; index += 1) if (coverCounts[index] > coverCounts[mostCommon]) mostCommon = index;
  const cover = coverCounts[mostCommon] > 0 ? COVER_GROUPS[mostCommon] : 'water';
  if (cover === 'water') return 'water';
  if (cover === 'snowAndIce') return 'glacier';
  if (meanElevation >= HeightBand.Summit) return 'summit';
  if (cover === 'trees') return meanElevation >= HeightBand.MountainForest ? 'mountainForest' : 'forest';
  if (cover === 'bare') return 'scree';
  if (cover === 'wetland') return 'marsh';
  if (meanElevation >= HeightBand.Scree) return 'scree';
  if (meanElevation >= HeightBand.AlpineMeadow) return 'alpineMeadow';
  return meanElevation >= HeightBand.Upland ? 'upland' : 'grass';
}

export const __testing__ = { HeightBand };
