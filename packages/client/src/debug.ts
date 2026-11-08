import type { EntityDef, LevelData, SimHandle, SimSnapshot } from '@novaland/sim';
import { entityDefs, hashSnapshot } from '@novaland/sim';
import type Phaser from 'phaser';
import { cameraView, type CameraView } from './render/camera';
import { PIXELS_PER_METRE } from './render/units';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  readonly sim: SimHandle;
  readonly game: Phaser.Game;
  readonly level: LevelData;
  readonly defs: readonly EntityDef[];
  readonly pixelsPerMetre: number;
  snapshot(): SimSnapshot;
  hash(): string;
  /** The world camera right now: zoom, scroll, bounds and what is on screen. */
  camera(): CameraView;
}

declare global {
  interface Window {
    __novaland?: NovalandDebugApi;
  }
}

export function exposeDebugApi(sim: SimHandle, game: Phaser.Game): void {
  window.__novaland = {
    sim,
    game,
    level: sim.level,
    defs: entityDefs,
    pixelsPerMetre: PIXELS_PER_METRE,
    snapshot: () => sim.snapshot(),
    hash: () => hashSnapshot(sim.snapshot()),
    camera: () => cameraView(game.scene.getScene('world').cameras.main),
  };
}
