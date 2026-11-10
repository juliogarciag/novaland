import type { Command, EntityDef, LevelData, SimHandle, SimSnapshot, TileGrid } from '@novaland/sim';
import { avatarDefIds, entityDefs, hashSnapshot, readTileGrid, tileAt, tileCentre } from '@novaland/sim';
import type Phaser from 'phaser';
import type { ConnectionStatus } from './online/connection';
import { cameraView, type CameraView } from './render/camera';
import { PIXELS_PER_METRE } from './render/units';
import { MIN_VISIBLE_METRES } from './render/zoom';
import type { PlayableWorld } from './worlds/PlayableWorld';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  /** The live sim solo, the replica online. */
  readonly sim: SimHandle;
  readonly game: Phaser.Game;
  readonly level: LevelData;
  /** The level's rows resolved into tile def ids, in metres. */
  readonly grid: TileGrid;
  /** The sim's own tile/metre conversions, so checks derive positions from content instead of recomputing them. */
  readonly tileAt: typeof tileAt;
  readonly tileCentre: typeof tileCentre;
  readonly defs: readonly EntityDef[];
  /** The def ids a joining player may be dressed in, so checks need not guess which defs are avatars. */
  readonly avatarDefIds: readonly number[];
  readonly pixelsPerMetre: number;
  /** Metres the camera always keeps visible across the window; its zoom follows from this. */
  readonly minVisibleMetres: number;
  /** Seat of the player at this keyboard. Online it can change after a reconnect. */
  localSlot(): number;
  snapshot(): SimSnapshot;
  hash(): string;
  /** The world camera right now: zoom, scroll, bounds and what is on screen. Undefined until the world scene runs. */
  camera(): CameraView | undefined;
  /** Queues a command for the next earned tick, through the same path as keyboard input. False until the world scene runs. */
  queueCommand(command: Command): boolean;
  /** Seats another player in the lowest empty slot, as the dev J key does. False until the world scene runs, and always online, where the server picks seats. */
  joinAnotherSeat(): boolean;
  /** Online only: the connection, as the screens see it. */
  readonly online?: OnlineDebugApi;
}

export interface OnlineDebugApi {
  status(): ConnectionStatus;
  /** Tries to join again now, like the screens' button. */
  retryNow(): void;
  /** Updates the replica refused as malformed since the page loaded. */
  malformedUpdates(): number;
  /** Ticks the drawn frame stays behind the newest server state, so checks can derive the expected lag. */
  readonly interpolationBufferTicks: number;
}

declare global {
  interface Window {
    __novaland?: NovalandDebugApi;
  }
}

export interface DebugApiOptions {
  readonly world: PlayableWorld;
  readonly game: Phaser.Game;
  readonly online?: OnlineDebugApi;
}

export function exposeDebugApi({ world, game, online }: DebugApiOptions): void {
  const { sim } = world;
  window.__novaland = {
    sim,
    game,
    level: sim.level,
    grid: readTileGrid(sim.level),
    tileAt,
    tileCentre,
    defs: entityDefs,
    avatarDefIds,
    pixelsPerMetre: PIXELS_PER_METRE,
    minVisibleMetres: MIN_VISIBLE_METRES,
    localSlot: () => world.localSlot,
    snapshot: () => sim.snapshot(),
    hash: () => hashSnapshot(sim.snapshot()),
    camera: () => (game.scene.isActive('world') ? cameraView(game.scene.getScene('world').cameras.main) : undefined),
    queueCommand: (command) => {
      if (!game.scene.isActive('world')) return false;
      world.queueCommand(command);
      return true;
    },
    joinAnotherSeat: () => {
      if (!game.scene.isActive('world') || !world.joinAnotherSeat) return false;
      world.joinAnotherSeat();
      return true;
    },
    ...(online ? { online } : {}),
  };
}
