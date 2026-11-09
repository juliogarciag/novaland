import Phaser from 'phaser';
import { exposeDebugApi, type OnlineDebugApi } from './debug';
import { OnlineWorld } from './online/OnlineWorld';
import { createConnectionScreens } from './online/screens';
import { worldServerUrl } from './online/serverUrl';
import { INTERPOLATION_BUFFER_TICKS } from './online/tuning';
import { keepCanvasAtWindowSize, windowViewportConfig } from './render/viewport';
import { HudScene } from './scenes/HudScene';
import { WorldScene } from './scenes/WorldScene';
import { createLocalWorld } from './worlds/LocalWorld';
import type { PlayableWorld } from './worlds/PlayableWorld';

/**
 * Boots the game around a playable world. With a world server to reach
 * (`VITE_SERVER_URL`, or the page's own origin in a production build, which
 * the world server serves itself) the world is the shared one on that server,
 * joined before the game exists (the level comes with the welcome); otherwise
 * this client runs its own sim, as it always did. The Phaser side is the same
 * in both modes.
 */
async function boot(): Promise<void> {
  const serverUrl = worldServerUrl({ configured: import.meta.env.VITE_SERVER_URL, isProduction: import.meta.env.PROD, pageOrigin: window.location.origin });
  const { world, online } = serverUrl ? await joinSharedWorld(serverUrl) : { world: await createLocalWorld(), online: undefined };
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0b0f14',
    // Nearest-neighbour textures and whole-pixel positions: pixel art stays crisp at any zoom.
    pixelArt: true,
    scene: [new WorldScene(world), new HudScene(world)],
    scale: windowViewportConfig(),
  });
  keepCanvasAtWindowSize(game);
  if (import.meta.env.DEV) exposeDebugApi({ world, game, online });
}

/**
 * Joins the world server, showing the connection screens until seated; they
 * stay for drops and come down again when seated. The screens' buttons reach
 * the connection from the first moment, before anyone is seated: that is
 * when the full and disconnected screens show.
 */
async function joinSharedWorld(serverUrl: string): Promise<{ world: PlayableWorld; online: OnlineDebugApi }> {
  // The screens need the connection and the connection reports to the screens; `join` returns synchronously, before any click can happen.
  const screens = createConnectionScreens(document.body, {
    onRetry: () => joining.connection.retryNow(),
    onReload: () => window.location.reload(),
  });
  const joining = OnlineWorld.join({ endpoint: serverUrl, onStatus: (status) => screens.show(status) });
  const world = await joining.seated;
  return {
    world,
    online: {
      status: () => world.connection.status,
      retryNow: () => world.connection.retryNow(),
      malformedUpdates: () => world.malformedUpdates,
      interpolationBufferTicks: INTERPOLATION_BUFFER_TICKS,
    },
  };
}

void boot();
