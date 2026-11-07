/**
 * Level data. Units are metres; the origin is the centre of the level and
 * the y axis points down, matching screen coordinates.
 */
export interface WallData {
  /** Centre position. */
  readonly x: number;
  readonly y: number;
  /** Full size. */
  readonly w: number;
  readonly h: number;
  /** Defaults to DefId.Wall. */
  readonly defId?: number;
}

export interface LevelData {
  readonly name: string;
  /** Playable size, including the border walls. */
  readonly width: number;
  readonly height: number;
  /** Where players appear. */
  readonly spawn: { readonly x: number; readonly y: number };
  readonly walls: readonly WallData[];
}
