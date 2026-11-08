/**
 * Sprite data for entity definitions. The sim never reads any of this: it is
 * rich data that views use to draw an entity from a sprite sheet instead of a
 * flat shape. Frames are numbered left to right, top to bottom, starting at 0.
 */

/** The four ways a character can look, named from the viewer's side (y points down, so `down` is towards the screen). */
export type SpriteDirection = 'down' | 'up' | 'left' | 'right';

/** Inclusive range of frame indices played in order. */
export interface FrameRange {
  readonly start: number;
  readonly end: number;
}

/** The frames a character shows while standing and walking one way. */
export interface DirectionalFrames {
  /** Frame shown while standing still. */
  readonly idle: number;
  /** Walk cycle, looped while the entity moves. */
  readonly walk: FrameRange;
}

export interface SpriteDef {
  /** Texture key. Views load `sprites/<key>.png` from the client's public folder. */
  readonly key: string;
  /** Size of one frame in texture pixels. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Texture pixels per sim metre the sheet was drawn at. Views scale by their own pixels per metre. */
  readonly pixelsPerMetre: number;
  /** Point of the frame, as fractions of its size, that sits on the entity's position. (0.5, 1) is the bottom centre. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Walk cycle speed in frames per second. */
  readonly frameRate: number;
  readonly directions: Readonly<Record<SpriteDirection, DirectionalFrames>>;
}
