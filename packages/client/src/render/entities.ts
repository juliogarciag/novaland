import { getDef, getRenderables, type SimHandle } from '@novaland/sim';
import type Phaser from 'phaser';
import { toPixels } from './units';

interface EntityView {
  readonly shape: Phaser.GameObjects.Shape;
  readonly defId: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Keeps one Phaser shape per sim entity and moves it to the entity's
 * position every frame. Shapes are created lazily and removed when the entity
 * disappears, so the view never owns state the sim does not have. Entity ids
 * are recycled by the sim, so a cached shape is reused only while its def and
 * size still match.
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
        view.shape.destroy();
        view = undefined;
      }
      if (!view) {
        const { defId, halfWidth, halfHeight } = renderable;
        view = { shape: this.createShape(defId, halfWidth, halfHeight), defId, halfWidth, halfHeight };
        this.views.set(renderable.eid, view);
      }
      view.shape.setPosition(toPixels(renderable.x), toPixels(renderable.y));
    }
    for (const [eid, view] of this.views) {
      if (!liveEntityIds.has(eid)) {
        view.shape.destroy();
        this.views.delete(eid);
      }
    }
  }

  private createShape(defId: number, halfWidth: number, halfHeight: number): Phaser.GameObjects.Shape {
    const def = getDef(defId);
    if (def.shape === 'circle') {
      return this.scene.add.circle(0, 0, toPixels(halfWidth), def.color);
    }
    return this.scene.add.rectangle(0, 0, toPixels(halfWidth * 2), toPixels(halfHeight * 2), def.color);
  }
}
