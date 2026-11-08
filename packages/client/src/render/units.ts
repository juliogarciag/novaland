/** The sim works in metres; the screen in pixels. This is the only place that knows the ratio. */
export const PIXELS_PER_METRE = 32;

export const toPixels = (metres: number): number => metres * PIXELS_PER_METRE;
