import type { Command, EntityDef, LevelData, SimHandle, SimSnapshot, TileGrid } from '@novaland/sim';
import { entityDefs, hashSnapshot, readTileGrid, tileAt, tileCentre } from '@novaland/sim';
import type Phaser from 'phaser';
import { cameraView, type CameraView } from './render/camera';
import { PIXELS_PER_METRE } from './render/units';
import { MIN_VISIBLE_METRES } from './render/zoom';
import { WorldScene } from './scenes/WorldScene';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  readonly sim: SimHandle;
  readonly game: Phaser.Game;
  readonly level: LevelData;
  /** The level's rows resolved into tile def ids, in metres. */
  readonly grid: TileGrid;
  /** The sim's own tile/metre conversions, so checks derive positions from content instead of recomputing them. */
  readonly tileAt: typeof tileAt;
  readonly tileCentre: typeof tileCentre;
  readonly defs: readonly EntityDef[];
  readonly pixelsPerMetre: number;
  /** Metres the camera always keeps visible across the window; its zoom follows from this. */
  readonly minVisibleMetres: number;
  snapshot(): SimSnapshot;
  hash(): string;
  /** The world camera right now: zoom, scroll, bounds and what is on screen. Undefined until the world scene runs. */
  camera(): CameraView | undefined;
  /** Queues a command for the next earned tick, through the same buffer as keyboard input. False until the world scene runs. */
  queueCommand(command: Command): boolean;
  /** Seats another player in the lowest empty slot, as the dev J key does. False until the world scene runs. */
  joinAnotherSeat(): boolean;
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
    tileAt,
    tileCentre,
    defs: entityDefs,
    pixelsPerMetre: PIXELS_PER_METRE,
    minVisibleMetres: MIN_VISIBLE_METRES,
    snapshot: () => sim.snapshot(),
    hash: () => hashSnapshot(sim.snapshot()),
    camera: () => (game.scene.isActive('world') ? cameraView(game.scene.getScene('world').cameras.main) : undefined),
    queueCommand: (command) => {
      const world = runningWorldScene(game);
      world?.enqueueCommand(command);
      return world !== undefined;
    },
    joinAnotherSeat: () => {
      const world = runningWorldScene(game);
      world?.joinAnotherSeat();
      return world !== undefined;
    },
  };
}

function runningWorldScene(game: Phaser.Game): WorldScene | undefined {
  if (!game.scene.isActive('world')) return undefined;
  const scene = game.scene.getScene('world');
  return scene instanceof WorldScene ? scene : undefined;
}
