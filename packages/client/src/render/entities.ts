import { getDef, type Character, type SimHandle, type SpriteDef } from '@novaland/sim';
import type Phaser from 'phaser';
import { lookKey } from './characterSheet';
import { depthOfBottomEdge } from './depth';
import { createNameLabel, fitNameLabel, NAME_GAP_PIXELS, type LabelScale } from './nameLabel';
import { IDLE_DOWN, poseFromHeading } from './pose';
import { lookTextureKey, walkAnimationKey } from './sprites';
import { PIXELS_PER_METRE, toPixels } from './units';
import { readViewFrame, type ViewFrame } from './viewFrame';

interface EntityView {
  readonly gameObject: Phaser.GameObjects.Shape | Phaser.GameObjects.Sprite;
  /** The same object as `gameObject` when the entity is drawn from a sheet, with the sheet that animates it and the texture it is drawn from (the sheet's own, or a look's). */
  readonly sheetSprite?: { readonly sprite: Phaser.GameObjects.Sprite; readonly sheet: SpriteDef; readonly textureKey: string };
  /** The name above the entity, for the ones that have a character. */
  readonly nameLabel?: Phaser.GameObjects.Text;
  /** Pixels from the entity's position up to the top of what is drawn for it, where the name sits. */
  readonly topOffset: number;
  /** The look the view was built for, as `lookKey` names it; undefined for an entity without a character. */
  readonly look: string | undefined;
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
 * is reused only while its def, size and look still match. An entity with a
 * character (a player) is drawn in its look's colours with its name above it.
 *
 * Everything is depth-sorted by the bottom edge of its body, so a character
 * standing south of a thing is drawn in front of it and north of it behind.
 */
export class EntityRenderer {
  private readonly views = new Map<number, EntityView>();
  private labelScale: LabelScale = { cameraZoom: 1, pixelRatio: 1 };

  constructor(private readonly scene: Phaser.Scene) {}

  /** Draws what `handle` holds right now. */
  sync(handle: SimHandle): void {
    this.draw(readViewFrame(handle));
  }

  /** Draws a frame: positions and headings that may lie between two states (online interpolation). */
  draw(frame: ViewFrame): void {
    this.fitLabelsToCamera();
    const liveEntityIds = new Set<number>();
    for (const renderable of frame.renderables) {
      liveEntityIds.add(renderable.eid);
      const character = frame.characters.get(renderable.eid);
      const look = character ? lookKey(character.look) : undefined;
      let view = this.views.get(renderable.eid);
      if (view && (view.defId !== renderable.defId || view.halfWidth !== renderable.halfWidth || view.halfHeight !== renderable.halfHeight || view.look !== look)) {
        destroyView(view);
        view = undefined;
      }
      if (!view) {
        view = this.createView(renderable.defId, { halfWidth: renderable.halfWidth, halfHeight: renderable.halfHeight, character });
        this.views.set(renderable.eid, view);
      }
      const x = toPixels(renderable.x);
      const y = toPixels(renderable.y);
      view.gameObject.setPosition(x, y);
      const depth = depthOfBottomEdge(renderable.y + renderable.halfHeight);
      if (view.gameObject.depth !== depth) view.gameObject.setDepth(depth); // setDepth queues a display-list sort even when unchanged
      if (view.sheetSprite) this.animate(view.sheetSprite, frame, renderable.eid);
      if (view.nameLabel && character) {
        // The id may have gone to another player with the same look between two frames: the label always says the current name.
        if (view.nameLabel.text !== character.name) {
          view.nameLabel.setText(character.name);
          fitNameLabel(view.nameLabel, this.labelScale);
        }
        view.nameLabel.setPosition(x, y - view.topOffset - NAME_GAP_PIXELS);
      }
    }
    for (const [eid, view] of this.views) {
      if (!liveEntityIds.has(eid)) {
        destroyView(view);
        this.views.delete(eid);
      }
    }
  }

  /** The names drawn right now, by entity id, with where each sits in world pixels. For end-to-end checks. */
  drawnNames(): { eid: number; name: string; x: number; y: number; textureKey: string | undefined }[] {
    const names: { eid: number; name: string; x: number; y: number; textureKey: string | undefined }[] = [];
    for (const [eid, view] of this.views) {
      if (view.nameLabel) names.push({ eid, name: view.nameLabel.text, x: view.nameLabel.x, y: view.nameLabel.y, textureKey: view.sheetSprite?.textureKey });
    }
    return names;
  }

  /** Where an entity is drawn, in pixels, or undefined when it has no game object (yet). */
  pixelPositionOf(eid: number): { x: number; y: number } | undefined {
    const view = this.views.get(eid);
    return view ? { x: view.gameObject.x, y: view.gameObject.y } : undefined;
  }

  private createView(defId: number, { halfWidth, halfHeight, character }: { halfWidth: number; halfHeight: number; character: Character | undefined }): EntityView {
    const def = getDef(defId);
    const sheet = def.sprite;
    const look = character ? lookKey(character.look) : undefined;
    const nameLabel = character ? createNameLabel(this.scene, character.name, this.labelScale) : undefined;
    if (sheet && this.scene.textures.exists(sheet.key)) {
      const textureKey = (character && lookTextureKey(this.scene, sheet, character.look)) ?? sheet.key;
      const sprite = this.scene.add.sprite(0, 0, textureKey, sheet.directions[IDLE_DOWN.direction].idle);
      const scale = PIXELS_PER_METRE / sheet.pixelsPerMetre;
      sprite.setOrigin(sheet.origin.x, sheet.origin.y);
      sprite.setScale(scale);
      return { gameObject: sprite, sheetSprite: { sprite, sheet, textureKey }, nameLabel, topOffset: sheet.frameHeight * sheet.origin.y * scale, look, defId, halfWidth, halfHeight };
    }
    const shape =
      def.shape === 'circle'
        ? this.scene.add.circle(0, 0, toPixels(halfWidth), def.color)
        : this.scene.add.rectangle(0, 0, toPixels(halfWidth * 2), toPixels(halfHeight * 2), def.color);
    return { gameObject: shape, nameLabel, topOffset: toPixels(halfHeight), look, defId, halfWidth, halfHeight };
  }

  /** Labels are rendered for one camera zoom and pixel ratio; when either changes (a resize, another screen) every label is rendered again. */
  private fitLabelsToCamera(): void {
    const cameraZoom = this.scene.cameras.main.zoom;
    const pixelRatio = 1 / this.scene.scale.zoom;
    if (cameraZoom === this.labelScale.cameraZoom && pixelRatio === this.labelScale.pixelRatio) return;
    this.labelScale = { cameraZoom, pixelRatio };
    for (const view of this.views.values()) {
      if (view.nameLabel) fitNameLabel(view.nameLabel, this.labelScale);
    }
  }

  /** Plays the walk cycle of the direction the entity moves in, or shows the idle frame of the direction it faces. */
  private animate({ sprite, sheet, textureKey }: NonNullable<EntityView['sheetSprite']>, frame: ViewFrame, eid: number): void {
    const heading = frame.headings.get(eid);
    const pose = heading ? poseFromHeading(heading) : IDLE_DOWN;
    if (pose.walking) {
      sprite.play(walkAnimationKey(textureKey, pose.direction), true);
      return;
    }
    if (sprite.anims.isPlaying) sprite.stop();
    sprite.setFrame(sheet.directions[pose.direction].idle);
  }
}

function destroyView(view: EntityView): void {
  view.gameObject.destroy();
  view.nameLabel?.destroy();
}
