import { characterShapes, entityDefs, type CharacterLook, type SpriteDef, type SpriteDirection } from '@novaland/sim';
import Phaser from 'phaser';
import { layerSheetsOf, lookKey, paintFigure, paintLook } from './characterSheet';
import { spriteSheetUrl } from './spriteUrl';

export const SPRITE_DIRECTIONS: readonly SpriteDirection[] = ['down', 'up', 'left', 'right'];

/** Name of the looping walk animation of a texture in one direction. */
export function walkAnimationKey(textureKey: string, direction: SpriteDirection): string {
  return `${textureKey}/walk/${direction}`;
}

/** Queues every sheet the defs reference, and the layer sheets characters are built from (one per gender and per hairstyle). Call from a scene's `preload`. */
export function loadSpriteSheets(scene: Phaser.Scene): void {
  for (const sprite of distinctSpriteSheets()) {
    scene.load.spritesheet(sprite.key, spriteSheetUrl(sprite.key), { frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight });
  }
  // Only their pixels are read, to build a look's texture: plain images.
  for (const shape of [...characterShapes.gender, ...characterShapes.hairStyle]) scene.load.image(shape.sheet, spriteSheetUrl(shape.sheet));
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
 * The texture that draws `sheet` in a look, made the first time a look is
 * seen: the hair sheet of the look's hairstyle laid over the body sheet of
 * its gender, outlined and recoloured (`paintFigure`), cut into the
 * frames of `sheet`, with its own walk animations. Players with the same look
 * share it. Without both layer sheets it is a recoloured copy of `sheet`
 * itself (the first gender with the first hairstyle). Undefined when
 * nothing loaded or the browser gives no canvas to paint on; the renderer
 * then draws the sheet as it is.
 */
export function lookTextureKey(scene: Phaser.Scene, sheet: SpriteDef, look: CharacterLook): string | undefined {
  const key = `${sheet.key}/look/${lookKey(look)}`;
  if (scene.textures.exists(key)) return key;
  const canvas = paintedLookCanvas(scene, sheet, look);
  if (!canvas) return undefined;
  // Phaser types the source as an image; a canvas is drawn from the same way.
  if (!scene.textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight })) return undefined;
  createWalkAnimations(scene, sheet, key);
  return key;
}

/** A canvas holding `sheet`'s frames in a look, from its layers when both loaded, else from `sheet` recoloured. */
function paintedLookCanvas(scene: Phaser.Scene, sheet: SpriteDef, look: CharacterLook): HTMLCanvasElement | undefined {
  const layers = layerSheetsOf(look);
  const fromLayers = layers !== undefined && scene.textures.exists(layers.body) && scene.textures.exists(layers.hair);
  // The player's own gender and hairstyle cannot be drawn: say so, rather than quietly drawing the default pair.
  if (layers && !fromLayers) console.warn(`novaland: layer sheets ${layers.body} or ${layers.hair} did not load; drawing ${sheet.key} instead`);
  if (!fromLayers && !scene.textures.exists(sheet.key)) return undefined;
  const sourceOf = (textureKey: string): CanvasImageSource => scene.textures.get(textureKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const base = sourceOf(fromLayers ? layers.body : sheet.key) as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  const pixelsOf = (source: CanvasImageSource): ImageData => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  const image = pixelsOf(base);
  if (fromLayers) {
    const hair = pixelsOf(sourceOf(layers.hair));
    image.data.set(paintFigure({ body: image.data, hair: hair.data, width: canvas.width, height: canvas.height }, look));
  } else {
    paintLook(image.data, look);
  }
  context.putImageData(image, 0, 0);
  return canvas;
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
