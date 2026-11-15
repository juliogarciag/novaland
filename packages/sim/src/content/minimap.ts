import type { CharacterPart } from '../features/player/defs';

/**
 * How a thing says it appears on the minimap. This is data for views: the
 * sim never reads it. An entity def carries one in `minimap` and a landmark
 * of the map has one (content/world/landmarks.ts); the minimap draws
 * whatever has a marker and nothing else, so a new kind of thing shows up
 * there by adding this to its def. Tiles need none: the minimap paints
 * every tile in its def's `color`.
 */
export interface MinimapMarker {
  readonly shape: MinimapMarkerShape;
  /** 0xRRGGBB. */
  readonly color: number;
  /**
   * For a thing that has a character (a player): the part of the character
   * whose colour the marker takes instead, so every player's marker is their
   * own. `color` stays the marker of a thing whose character cannot be read.
   */
  readonly colorFromCharacter?: CharacterPart;
  /**
   * What happens when the thing is further away than the minimap reaches:
   * `edge` keeps the marker on the minimap's edge, on the side the thing is
   * on, so it can be walked toward; `hidden` drops it.
   */
  readonly beyondRange: 'edge' | 'hidden';
}

/** `dot` is for things that move about, `diamond` for places. A view draws each shape its own way; a new shape is a new name here and a case in the view. */
export type MinimapMarkerShape = 'dot' | 'diamond';
