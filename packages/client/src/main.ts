import { createSim, starterLevel } from '@novaland/sim';
import Phaser from 'phaser';
import { exposeDebugApi } from './debug';
import { keepCanvasAtWindowSize, windowViewportConfig } from './render/viewport';
import { HudScene } from './scenes/HudScene';
import { WorldScene } from './scenes/WorldScene';

async function boot(): Promise<void> {
  const sim = await createSim({ seed: 1, level: starterLevel });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0b0f14',
    // Nearest-neighbour textures and whole-pixel positions: pixel art stays crisp at any zoom.
    pixelArt: true,
    scene: [new WorldScene(sim), new HudScene(sim)],
    scale: windowViewportConfig(),
  });
  keepCanvasAtWindowSize(game);
  if (import.meta.env.DEV) exposeDebugApi(sim, game);
}

void boot();
