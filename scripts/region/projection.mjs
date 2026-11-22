/**
 * How a region's tiles sit on the Earth. The projection is equirectangular
 * (equidistant cylindrical) on a sphere, with the region's middle latitude
 * as its standard parallel: a column is a fixed step of longitude and a row
 * a fixed step of latitude, chosen so that a tile is `kilometresPerTile`
 * tall everywhere and `kilometresPerTile` wide at the middle latitude.
 * North and south of it a tile is a few percent narrower or wider on the
 * ground; a region a few hundred kilometres tall does not show it.
 */

/** Mean radius of the Earth (IUGG), in kilometres. */
const EARTH_RADIUS_KILOMETRES = 6371.0088;
const KILOMETRES_PER_DEGREE = (Math.PI * EARTH_RADIUS_KILOMETRES) / 180;

/**
 * The grid of a region: the corner it starts at and the degrees one column
 * and one row cover. `standardParallel` is the latitude where a tile is
 * exactly square on the ground. The numbers are rounded to nine decimals
 * (a tenth of a millimetre) so the file they are written to reads the same
 * on every machine.
 */
export function gridOfRegion({ kilometresPerTile, columns, rows, north, west }) {
  const degreesPerRow = roundToNineDecimals(kilometresPerTile / KILOMETRES_PER_DEGREE);
  const standardParallel = roundToNineDecimals(north - (rows * degreesPerRow) / 2);
  const degreesPerColumn = roundToNineDecimals(kilometresPerTile / (KILOMETRES_PER_DEGREE * Math.cos((standardParallel * Math.PI) / 180)));
  return { columns, rows, north, west, degreesPerColumn, degreesPerRow, standardParallel, kilometresPerTile };
}

/** The four edges of a grid, in degrees. */
export function boundsOfGrid(grid) {
  return { north: grid.north, west: grid.west, south: grid.north - grid.rows * grid.degreesPerRow, east: grid.west + grid.columns * grid.degreesPerColumn };
}

/** Where a point of the Earth falls on the grid, in tiles and fractions of a tile from the top-left corner. It may be outside the grid. */
export function gridPositionOf(grid, { latitude, longitude }) {
  return { column: (longitude - grid.west) / grid.degreesPerColumn, row: (grid.north - latitude) / grid.degreesPerRow };
}

function roundToNineDecimals(value) {
  return Math.round(value * 1e9) / 1e9;
}
