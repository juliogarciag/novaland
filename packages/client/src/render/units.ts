/**
 * The sim works in metres; textures in pixels. One metre is one tile of 16
 * texture pixels. This ratio never decides on-screen size: the camera's
 * whole-number zoom does (see `render/zoom.ts`).
 */
export const PIXELS_PER_METRE = 16;

export const toPixels = (metres: number): number => metres * PIXELS_PER_METRE;
