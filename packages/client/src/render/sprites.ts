import { entityDefs, type SpriteDef, type SpriteDirection } from '@novaland/sim';
import Phaser from 'phaser';

export const SPRITE_DIRECTIONS: readonly SpriteDirection[] = ['down', 'up', 'left', 'right'];

/** Where a sheet lives: `public/sprites/<key>.png`, served from the site root. */
export function spriteSheetUrl(key: string): string {
  return `${import.meta.env.BASE_URL}sprites/${key}.png`;
}

/** Name of the looping walk animation of a sheet in one direction. */
export function walkAnimationKey(spriteKey: string, direction: SpriteDirection): string {
  return `${spriteKey}/walk/${direction}`;
}

/** Queues every sheet the defs reference. Call from a scene's `preload`. */
export function loadSpriteSheets(scene: Phaser.Scene): void {
  for (const sprite of spriteDefs()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight });
  }
}

/**
 * Registers the walk animations of every sheet that loaded and keeps their
 * pixels crisp when scaled. Call from `create`. A sheet that failed to load
 * is skipped: the renderer then falls back to the def's flat shape.
 */
export function createSpriteAnimations(scene: Phaser.Scene): void {
  for (const sprite of spriteDefs()) {
    if (!scene.textures.exists(sprite.key)) continue;
    scene.textures.get(sprite.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const direction of SPRITE_DIRECTIONS) {
      const key = walkAnimationKey(sprite.key, direction);
      if (scene.anims.exists(key)) continue;
      const { walk } = sprite.directions[direction];
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(sprite.key, { start: walk.start, end: walk.end }),
        frameRate: sprite.frameRate,
        repeat: -1,
      });
    }
  }
}

/** Every distinct sheet the defs reference, in def order. */
function spriteDefs(): SpriteDef[] {
  const byKey = new Map<string, SpriteDef>();
  for (const def of entityDefs) {
    if (def.sprite && !byKey.has(def.sprite.key)) byKey.set(def.sprite.key, def.sprite);
  }
  return [...byKey.values()];
}
