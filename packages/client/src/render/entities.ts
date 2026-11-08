import { getDef, getPlayerHeading, getRenderables, type SimHandle, type SpriteDef } from '@novaland/sim';
import type Phaser from 'phaser';
import { IDLE_DOWN, poseFromHeading } from './pose';
import { walkAnimationKey } from './sprites';
import { PIXELS_PER_METRE, toPixels } from './units';

interface EntityView {
  readonly gameObject: Phaser.GameObjects.Shape | Phaser.GameObjects.Sprite;
  /** Set when the entity is drawn from a sheet; the renderer then animates it every frame. */
  readonly animated?: { readonly sprite: Phaser.GameObjects.Sprite; readonly sheet: SpriteDef };
  readonly defId: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Keeps one Phaser game object per sim entity and moves it to the entity's
 * position every frame. A def with a loaded sprite sheet is drawn as an
 * animated sprite; anything else as a flat shape. Objects are created lazily
 * and removed when the entity disappears, so the view never owns state the
 * sim does not have. Entity ids are recycled by the sim, so a cached object
 * is reused only while its def and size still match.
 *
 * Everything is depth-sorted by the bottom edge of its body, so a character
 * standing south of a thing is drawn in front of it and north of it behind.
 */
export class EntityRenderer {
  private readonly views = new Map<number, EntityView>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(sim: SimHandle): void {
    const liveEntityIds = new Set<number>();
    for (const renderable of getRenderables(sim)) {
      liveEntityIds.add(renderable.eid);
      let view = this.views.get(renderable.eid);
      if (view && (view.defId !== renderable.defId || view.halfWidth !== renderable.halfWidth || view.halfHeight !== renderable.halfHeight)) {
        view.gameObject.destroy();
        view = undefined;
      }
      if (!view) {
        view = this.createView(renderable.defId, renderable.halfWidth, renderable.halfHeight);
        this.views.set(renderable.eid, view);
      }
      view.gameObject.setPosition(toPixels(renderable.x), toPixels(renderable.y));
      view.gameObject.setDepth(toPixels(renderable.y + renderable.halfHeight));
      if (view.animated) this.animate(view.animated, sim, renderable.eid);
    }
    for (const [eid, view] of this.views) {
      if (!liveEntityIds.has(eid)) {
        view.gameObject.destroy();
        this.views.delete(eid);
      }
    }
  }

  private createView(defId: number, halfWidth: number, halfHeight: number): EntityView {
    const def = getDef(defId);
    const sheet = def.sprite;
    if (sheet && this.scene.textures.exists(sheet.key)) {
      const sprite = this.scene.add.sprite(0, 0, sheet.key, sheet.directions[IDLE_DOWN.direction].idle);
      sprite.setOrigin(sheet.origin.x, sheet.origin.y);
      sprite.setScale(PIXELS_PER_METRE / sheet.pixelsPerMetre);
      return { gameObject: sprite, animated: { sprite, sheet }, defId, halfWidth, halfHeight };
    }
    const shape =
      def.shape === 'circle'
        ? this.scene.add.circle(0, 0, toPixels(halfWidth), def.color)
        : this.scene.add.rectangle(0, 0, toPixels(halfWidth * 2), toPixels(halfHeight * 2), def.color);
    return { gameObject: shape, defId, halfWidth, halfHeight };
  }

  /** Plays the walk cycle of the direction the entity moves in, or shows the idle frame of the direction it faces. */
  private animate({ sprite, sheet }: NonNullable<EntityView['animated']>, sim: SimHandle, eid: number): void {
    const heading = getPlayerHeading(sim, eid);
    const pose = heading ? poseFromHeading(heading) : IDLE_DOWN;
    if (pose.walking) {
      sprite.play(walkAnimationKey(sheet.key, pose.direction), true);
      return;
    }
    if (sprite.anims.isPlaying) sprite.stop();
    sprite.setFrame(sheet.directions[pose.direction].idle);
  }
}
