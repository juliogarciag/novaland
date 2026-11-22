/**
 * The public datasets a region is made from, and how each is cut into
 * files. Every one of them allows this use; the licence and the credit line
 * it asks for are recorded here and written into the generated map.
 */

/** Elevation: Copernicus DEM GLO-90, one cloud-optimised GeoTIFF per degree, 3 arc seconds a pixel. */
export const elevationSource = {
  name: 'Copernicus DEM GLO-90',
  licence: 'Copernicus DEM licence: free of charge for any use, derived works included, with the credit line',
  credit: '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
  degreesPerFile: 1,
  /** Width in pixels of the overview read: 600 across a degree is about 185 m, six to nine samples across a 1.2 km tile. */
  overviewWidth: 600,
  urlOfFile({ south, west }) {
    const name = `Copernicus_DSM_COG_30_${latitudeLabel(south)}_00_${longitudeLabel(west)}_00_DEM`;
    return `https://copernicus-dem-90m.s3.amazonaws.com/${name}/${name}.tif`;
  },
};

/** Land cover: ESA WorldCover 2021, one cloud-optimised GeoTIFF per 3 by 3 degrees, 10 m a pixel. */
export const landCoverSource = {
  name: 'ESA WorldCover 10 m 2021 v200',
  licence: 'CC BY 4.0',
  credit: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  degreesPerFile: 3,
  /** Width in pixels of the overview read: 2250 across three degrees is about 150 m, eight to eleven samples across a 1.2 km tile. */
  overviewWidth: 2250,
  urlOfFile({ south, west }) {
    return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${latitudeLabel(south)}${longitudeLabel(west)}_Map.tif`;
  },
};

/** Rivers and lakes: Natural Earth 1:10m, as the GeoJSON its repository publishes. */
export const waterSource = {
  name: 'Natural Earth 1:10m rivers, lake centerlines and lakes, with the Europe supplements (v5.1.2)',
  licence: 'Public domain',
  credit: 'Made with Natural Earth',
  riverFiles: ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe'],
  lakeFiles: ['ne_10m_lakes', 'ne_10m_lakes_europe'],
  urlOfFile(file) {
    return `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/${file}.geojson`;
  },
};

/** The classes of ESA WorldCover, by the value the raster holds. 0 is "no data": open sea away from any coast. */
export const LandCover = { NoData: 0, Trees: 10, Shrubland: 20, Grassland: 30, Cropland: 40, BuiltUp: 50, Bare: 60, SnowAndIce: 70, Water: 80, Wetland: 90, Mangroves: 95, MossAndLichen: 100 };

/** The south-west corners of the files of a source that touch these bounds. */
export function filesCovering({ degreesPerFile }, { north, south, west, east }) {
  const files = [];
  for (let fileSouth = floorTo(south, degreesPerFile); fileSouth < north; fileSouth += degreesPerFile) {
    for (let fileWest = floorTo(west, degreesPerFile); fileWest < east; fileWest += degreesPerFile) files.push({ south: fileSouth, west: fileWest });
  }
  return files;
}

function floorTo(value, step) {
  return Math.floor(value / step) * step;
}

/** A whole latitude the way both datasets name their files: N46, S03. */
function latitudeLabel(degrees) {
  return `${degrees >= 0 ? 'N' : 'S'}${String(Math.abs(degrees)).padStart(2, '0')}`;
}

/** A whole longitude the way both datasets name their files: E007, W070. */
function longitudeLabel(degrees) {
  return `${degrees >= 0 ? 'E' : 'W'}${String(Math.abs(degrees)).padStart(3, '0')}`;
}
