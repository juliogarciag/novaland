import type { EntityDef, LevelData, SimHandle, SimSnapshot, TileGrid } from '@novaland/sim';
import { entityDefs, hashSnapshot, readTileGrid } from '@novaland/sim';
import type Phaser from 'phaser';
import { cameraView, type CameraView } from './render/camera';
import { PIXELS_PER_METRE } from './render/units';
import { MIN_VISIBLE_METRES } from './render/zoom';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  readonly sim: SimHandle;
  readonly game: Phaser.Game;
  readonly level: LevelData;
  /** The level's rows resolved into tile def ids, in metres. */
  readonly grid: TileGrid;
  readonly defs: readonly EntityDef[];
  readonly pixelsPerMetre: number;
  /** Metres the camera always keeps visible across the window; its zoom follows from this. */
  readonly minVisibleMetres: number;
  snapshot(): SimSnapshot;
  hash(): string;
  /** The world camera right now: zoom, scroll, bounds and what is on screen. Undefined until the world scene runs. */
  camera(): CameraView | undefined;
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
    grid: readTileGrid(sim.level),
    defs: entityDefs,
    pixelsPerMetre: PIXELS_PER_METRE,
    minVisibleMetres: MIN_VISIBLE_METRES,
    snapshot: () => sim.snapshot(),
    hash: () => hashSnapshot(sim.snapshot()),
    camera: () => (game.scene.isActive('world') ? cameraView(game.scene.getScene('world').cameras.main) : undefined),
  };
}
