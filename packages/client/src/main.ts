import { createSim, starterLevel } from '@novaland/sim';
import Phaser from 'phaser';
import { exposeDebugApi } from './debug';
import { WorldScene } from './scenes/WorldScene';

const WIDTH = 960;
const HEIGHT = 720;

async function boot(): Promise<void> {
  const sim = await createSim({ seed: 1, level: starterLevel });
  const scene = new WorldScene(sim);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#0b0f14',
    scene: [scene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  if (import.meta.env.DEV) exposeDebugApi(sim, game);
}

void boot();
