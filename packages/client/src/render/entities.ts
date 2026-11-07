import { getDef, getRenderables, type SimHandle } from '@novaland/sim';
import type Phaser from 'phaser';
import { toPixels } from './units';

interface EntityView {
  readonly shape: Phaser.GameObjects.Shape;
  readonly defId: number;
  readonly hw: number;
  readonly hh: number;
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
    const seen = new Set<number>();
    for (const r of getRenderables(sim)) {
      seen.add(r.eid);
      let view = this.views.get(r.eid);
      if (view && (view.defId !== r.defId || view.hw !== r.hw || view.hh !== r.hh)) {
        view.shape.destroy();
        view = undefined;
      }
      if (!view) {
        view = { shape: this.createShape(r.defId, r.hw, r.hh), defId: r.defId, hw: r.hw, hh: r.hh };
        this.views.set(r.eid, view);
      }
      view.shape.setPosition(toPixels(r.x), toPixels(r.y));
    }
    for (const [eid, view] of this.views) {
      if (!seen.has(eid)) {
        view.shape.destroy();
        this.views.delete(eid);
      }
    }
  }

  private createShape(defId: number, hw: number, hh: number): Phaser.GameObjects.Shape {
    const def = getDef(defId);
    if (def.shape === 'circle') {
      return this.scene.add.circle(0, 0, toPixels(hw), def.color);
    }
    return this.scene.add.rectangle(0, 0, toPixels(hw * 2), toPixels(hh * 2), def.color);
  }
}
