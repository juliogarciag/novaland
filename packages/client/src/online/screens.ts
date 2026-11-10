import type { ConnectionStatus } from './connection';
import { WORLD_SEATS } from './tuning';

/** The overlay that tells the player where the connection stands. Hidden while online. */
export interface ConnectionScreens {
  show(status: ConnectionStatus): void;
  destroy(): void;
}

/** How often a "retrying in Ns" line is redrawn. */
const COUNTDOWN_INTERVAL_MS = 250;

export interface ConnectionScreenActions {
  /** The "Retry now" button of the full and disconnected screens. */
  readonly onRetry: () => void;
  /** The "Reload page" button of the incompatible screen: the only way on from there, and the player's choice, never the page's own. */
  readonly onReload: () => void;
}

/**
 * Plain DOM over the canvas, not a Phaser scene: it has to show before the
 * game exists (nothing to draw until a welcome brings the level) and it must
 * not depend on a render loop that stops with the connection. `data-screen`
 * names the screen for end-to-end checks.
 */
export function createConnectionScreens(parent: HTMLElement, actions: ConnectionScreenActions): ConnectionScreens {
  const screen = document.createElement('div');
  screen.id = 'screen';
  screen.hidden = true;
  const message = document.createElement('p');
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = 'Retry now';
  retryButton.addEventListener('click', actions.onRetry);
  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.textContent = 'Reload page';
  reloadButton.addEventListener('click', actions.onReload);
  screen.append(message, retryButton, reloadButton);
  parent.append(screen);
  let countdown: ReturnType<typeof setInterval> | undefined;
  let shown: ConnectionStatus | undefined;

  const render = (): void => {
    if (!shown) return;
    message.textContent = describeStatus(shown);
    retryButton.hidden = shown.kind !== 'full' && shown.kind !== 'disconnected';
    reloadButton.hidden = shown.kind !== 'incompatible';
  };

  return {
    show(status) {
      shown = status;
      if (countdown !== undefined) clearInterval(countdown);
      countdown = undefined;
      if (status.kind === 'online') {
        screen.hidden = true;
        return;
      }
      screen.hidden = false;
      screen.dataset['screen'] = status.kind;
      render();
      if (status.kind === 'full' || status.kind === 'disconnected') countdown = setInterval(render, COUNTDOWN_INTERVAL_MS);
    },
    destroy() {
      if (countdown !== undefined) clearInterval(countdown);
      screen.remove();
    },
  };
}

/** The line the player reads for a status. */
function describeStatus(status: ConnectionStatus): string {
  switch (status.kind) {
    case 'connecting':
      return status.attempt > 1 ? `Connecting to the world… (attempt ${status.attempt})` : 'Connecting to the world…';
    case 'online':
      return '';
    case 'full':
      return `The world is full (${WORLD_SEATS}/${WORLD_SEATS} online). Retrying in ${secondsUntil(status.retryAt)}s.`;
    case 'disconnected':
      return `Disconnected from the world. Retrying in ${secondsUntil(status.retryAt)}s…`;
    case 'incompatible':
      return `Cannot play on this server: ${status.reason}.`;
  }
}

function secondsUntil(timestamp: number): number {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

export const __testing__ = { describeStatus };
