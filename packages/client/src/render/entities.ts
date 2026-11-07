import { getDef, getRenderables, type Sim } from '@novaland/sim';
import type Phaser from 'phaser';
import { toPixels } from './units';

/**
 * Keeps one Phaser shape per sim entity and moves it to the entity's
 * position every frame. Shapes are created lazily and removed when the entity
 * disappears, so the view never owns state the sim does not have.
 */
export class EntityRenderer {
  private readonly shapes = new Map<number, Phaser.GameObjects.Shape>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(sim: Sim): void {
    const seen = new Set<number>();
    for (const r of getRenderables(sim)) {
      seen.add(r.eid);
      let shape = this.shapes.get(r.eid);
      if (!shape) {
        shape = this.createShape(r.defId, r.hw, r.hh);
        this.shapes.set(r.eid, shape);
      }
      shape.setPosition(toPixels(r.x), toPixels(r.y));
    }
    for (const [eid, shape] of this.shapes) {
      if (!seen.has(eid)) {
        shape.destroy();
        this.shapes.delete(eid);
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
