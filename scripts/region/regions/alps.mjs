/**
 * The Alps, from Geneva to Venice: high mountains, large lakes, big rivers,
 * the Po plain and a piece of two seas (the Adriatic off Venice, the Gulf of
 * Genoa). The first real region, made to judge the scale (ticket #70).
 */
export const alps = {
  name: 'alps',
  /** How much real ground one tile covers, along both axes at the middle of the region. */
  kilometresPerTile: 0.6,
  /** Whole chunks of 32 tiles: 28 by 20. */
  columns: 896,
  rows: 640,
  /** The north-west corner of the map: the top-left corner of tile (0, 0). */
  north: 47.75,
  west: 5.85,
  /** Players appear on the walkable tile nearest to this: the south end of Lake Como. */
  spawn: { latitude: 45.8, longitude: 9.07 },
};
