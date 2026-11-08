import Phaser from 'phaser';

/**
 * The window is the viewport, at full Retina resolution.
 *
 * Phaser's RESIZE scale mode copies the parent's CSS size into the canvas,
 * so on a 2x display every game pixel covers four screen pixels and the art
 * blurs. Instead the canvas backing store is the window in device pixels and
 * Phaser's own `zoom` shrinks it back to CSS size, which is what RESIZE
 * would do minus the blur. Nothing here is game state.
 */

interface DevicePixelWindow {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/** The window measured in device pixels, as the canvas backing store must be. */
function windowInDevicePixels(): DevicePixelWindow {
  const pixelRatio = window.devicePixelRatio || 1;
  return {
    width: Math.max(1, Math.round(window.innerWidth * pixelRatio)),
    height: Math.max(1, Math.round(window.innerHeight * pixelRatio)),
    pixelRatio,
  };
}

/** Scale config that opens the game at the window's size. Pair with `keepCanvasAtWindowSize`. */
export function windowViewportConfig(): Phaser.Types.Core.ScaleConfig {
  const { width, height, pixelRatio } = windowInDevicePixels();
  return { mode: Phaser.Scale.NONE, width, height, zoom: 1 / pixelRatio };
}

/** Resizes the canvas with the window, and re-scales it when the pixel ratio changes (window dragged to another screen). */
export function keepCanvasAtWindowSize(game: Phaser.Game): void {
  const fit = (): void => {
    const { width, height, pixelRatio } = windowInDevicePixels();
    if (game.scale.zoom !== 1 / pixelRatio) game.scale.setZoom(1 / pixelRatio);
    if (game.scale.width !== width || game.scale.height !== height) game.scale.resize(width, height);
    watchPixelRatio(pixelRatio, fit);
  };
  window.addEventListener('resize', fit);
  fit();
}

let stopWatchingPixelRatio: (() => void) | undefined;

/** Calls `onChange` once the pixel ratio stops being `pixelRatio`; the browser fires no resize event for that. */
function watchPixelRatio(pixelRatio: number, onChange: () => void): void {
  stopWatchingPixelRatio?.();
  const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
  query.addEventListener('change', onChange, { once: true });
  stopWatchingPixelRatio = () => query.removeEventListener('change', onChange);
}
