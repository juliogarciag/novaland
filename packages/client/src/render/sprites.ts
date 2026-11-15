import { entityDefs, type CharacterLook, type SpriteDef, type SpriteDirection } from '@novaland/sim';
import Phaser from 'phaser';
import { lookKey, paintLook } from './characterSheet';
import { spriteSheetUrl } from './spriteUrl';

export const SPRITE_DIRECTIONS: readonly SpriteDirection[] = ['down', 'up', 'left', 'right'];

/** Name of the looping walk animation of a texture in one direction. */
export function walkAnimationKey(textureKey: string, direction: SpriteDirection): string {
  return `${textureKey}/walk/${direction}`;
}

/** Queues every sheet the defs reference. Call from a scene's `preload`. */
export function loadSpriteSheets(scene: Phaser.Scene): void {
  for (const sprite of distinctSpriteSheets()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight });
  }
}

/**
 * Registers the walk animations of every sheet that loaded and keeps their
 * pixels crisp when scaled. Call from `create`. A sheet that failed to load
 * is skipped: the renderer then falls back to the def's flat shape.
 */
export function createSpriteAnimations(scene: Phaser.Scene): void {
  for (const sprite of distinctSpriteSheets()) {
    if (scene.textures.exists(sprite.key)) createWalkAnimations(scene, sprite, sprite.key);
  }
}

/**
 * The texture that draws `sheet` in a look's colours, made the first time a
 * look is seen: a copy of the sheet's texture with the template colours
 * swapped (characterSheet.ts), cut into the same frames, with its own walk
 * animations. Players with the same look share it. Undefined when the sheet
 * did not load or the browser gives no canvas to paint on; the renderer then
 * draws the sheet as it is.
 */
export function lookTextureKey(scene: Phaser.Scene, sheet: SpriteDef, look: CharacterLook): string | undefined {
  const key = `${sheet.key}/look/${lookKey(look)}`;
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists(sheet.key)) return undefined;
  const template = scene.textures.get(sheet.key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = template.width;
  canvas.height = template.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(template, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  paintLook(image.data, look);
  context.putImageData(image, 0, 0);
  // Phaser types the source as an image; a canvas is drawn from the same way.
  if (!scene.textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight })) return undefined;
  createWalkAnimations(scene, sheet, key);
  return key;
}

/** The walk animations of `sheet`'s layout over the texture `textureKey`, which is kept crisp when scaled. */
function createWalkAnimations(scene: Phaser.Scene, sheet: SpriteDef, textureKey: string): void {
  scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (const direction of SPRITE_DIRECTIONS) {
    const key = walkAnimationKey(textureKey, direction);
    if (scene.anims.exists(key)) continue;
    const { walk } = sheet.directions[direction];
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(textureKey, { start: walk.start, end: walk.end }),
      frameRate: sheet.frameRate,
      repeat: -1,
    });
  }
}

/** Every distinct sheet the defs reference, in def order. */
function distinctSpriteSheets(): SpriteDef[] {
  const byKey = new Map<string, SpriteDef>();
  for (const def of entityDefs) {
    if (def.sprite && !byKey.has(def.sprite.key)) byKey.set(def.sprite.key, def.sprite);
  }
  return [...byKey.values()];
}
