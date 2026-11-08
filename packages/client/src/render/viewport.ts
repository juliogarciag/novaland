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
  const reported = window.devicePixelRatio;
  const pixelRatio = Number.isFinite(reported) && reported > 0 ? reported : 1;
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

/**
 * Resizes the canvas with the window, and re-scales it when the pixel ratio
 * changes (window dragged to another screen). Returns a function that stops.
 */
export function keepCanvasAtWindowSize(game: Phaser.Game): () => void {
  let stopWatchingPixelRatio: (() => void) | undefined;

  const fit = (): void => {
    const { width, height, pixelRatio } = windowInDevicePixels();
    stopWatchingPixelRatio?.();
    stopWatchingPixelRatio = watchPixelRatio(pixelRatio, fit);
    const zoom = 1 / pixelRatio;
    const sizeChanged = game.scale.width !== width || game.scale.height !== height;
    if (!sizeChanged && game.scale.zoom === zoom) return;
    if (sizeChanged) game.scale.resize(width, height);
    // Always after the resize: `setZoom` is what writes the canvas CSS size from the
    // game size; `resize` alone leaves it stale once the zoom is 1.
    game.scale.setZoom(zoom);
  };

  // The window event covers resizes and screen moves; watching the parent as
  // well catches a page laid out at 0x0 (hidden tab) that only gets its size later.
  const parent = game.scale.parent instanceof HTMLElement ? game.scale.parent : undefined;
  const observer = parent && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
  const start = (): void => {
    window.addEventListener('resize', fit);
    if (observer && parent) observer.observe(parent);
    fit();
  };
  if (game.isBooted) start();
  else game.events.once(Phaser.Core.Events.READY, start);

  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', fit);
    stopWatchingPixelRatio?.();
  };
}

/** Calls `onChange` once the pixel ratio stops being `pixelRatio`; the browser fires no resize event for that. Returns a function that stops. */
function watchPixelRatio(pixelRatio: number, onChange: () => void): () => void {
  const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
  query.addEventListener('change', onChange, { once: true });
  return () => query.removeEventListener('change', onChange);
}
