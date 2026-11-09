import Phaser from 'phaser';
import { exposeDebugApi, type OnlineDebugApi } from './debug';
import { OnlineWorld } from './online/OnlineWorld';
import { createConnectionScreens } from './online/screens';
import { keepCanvasAtWindowSize, windowViewportConfig } from './render/viewport';
import { HudScene } from './scenes/HudScene';
import { WorldScene } from './scenes/WorldScene';
import { createLocalWorld } from './worlds/LocalWorld';
import type { PlayableWorld } from './worlds/PlayableWorld';

/**
 * Boots the game around a playable world. With `VITE_SERVER_URL` set the
 * world is the shared one on that server, joined before the game exists
 * (the level comes with the welcome); otherwise this client runs its own
 * sim, as it always did. The Phaser side is the same in both modes.
 */
async function boot(): Promise<void> {
  const serverUrl = import.meta.env.VITE_SERVER_URL;
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

/** Connects to the world server, showing the connection screens until seated; they stay up for drops and come down again when seated. */
async function joinSharedWorld(serverUrl: string): Promise<{ world: PlayableWorld; online: OnlineDebugApi }> {
  let retryNow = (): void => undefined;
  const screens = createConnectionScreens(document.body, () => retryNow());
  let seated = false;
  const world = await OnlineWorld.connect({
    endpoint: serverUrl,
    onStatus: (status) => {
      screens.show(status);
      // The scene was built for the first welcome's level; a different world after a drop needs a fresh page.
      if (status.kind === 'incompatible' && seated) window.location.reload();
    },
  });
  seated = true;
  retryNow = () => world.connection.retryNow();
  return {
    world,
    online: {
      status: () => world.connection.status,
      retryNow,
      malformedUpdates: () => world.malformedUpdates,
    },
  };
}

void boot();
