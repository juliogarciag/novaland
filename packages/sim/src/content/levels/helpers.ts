import type { WallData } from './types';

/** Four walls of `thickness` hugging the inside of a `width` x `height` rectangle centred at the origin. */
export function borderWalls(width: number, height: number, thickness: number): WallData[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const t = thickness;
  return [
    { x: 0, y: -halfHeight + t / 2, w: width, h: t },
    { x: 0, y: halfHeight - t / 2, w: width, h: t },
    { x: -halfWidth + t / 2, y: 0, w: t, h: height - 2 * t },
    { x: halfWidth - t / 2, y: 0, w: t, h: height - 2 * t },
  ];
}
