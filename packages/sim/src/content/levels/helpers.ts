import type { WallData } from './types';

/** Four walls of `thickness` hugging the inside of a `width` x `height` rectangle centred at the origin. */
export function borderWalls(width: number, height: number, thickness: number): WallData[] {
  const hw = width / 2;
  const hh = height / 2;
  const t = thickness;
  return [
    { x: 0, y: -hh + t / 2, w: width, h: t },
    { x: 0, y: hh - t / 2, w: width, h: t },
    { x: -hw + t / 2, y: 0, w: t, h: height - 2 * t },
    { x: hw - t / 2, y: 0, w: t, h: height - 2 * t },
  ];
}
