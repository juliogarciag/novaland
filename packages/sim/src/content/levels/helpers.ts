import type { WallData } from './types';

/** Four walls of `thickness` hugging the inside of a `width` x `height` rectangle centred at the origin. */
export function borderWalls(width: number, height: number, thickness: number): WallData[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const innerHeight = height - 2 * thickness;
  return [
    { x: 0, y: -halfHeight + thickness / 2, width, height: thickness },
    { x: 0, y: halfHeight - thickness / 2, width, height: thickness },
    { x: -halfWidth + thickness / 2, y: 0, width: thickness, height: innerHeight },
    { x: halfWidth - thickness / 2, y: 0, width: thickness, height: innerHeight },
  ];
}
