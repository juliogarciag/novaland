import type { Character, Command, EntityDef, MapTiles, SimHandle, SimSnapshot, TileCoordinate, WorldMap } from '@novaland/sim';
import { characterPalettes, CHUNK_SIZE, entityDefs, getCharacter, getRenderables, hashSnapshot, readMapTiles, tileAt, tileCentre, tileDefIdAt } from '@novaland/sim';
import type Phaser from 'phaser';
import type { MinimapReport } from './hud/minimap';
import type { ConnectionStatus } from './online/connection';
import type { PredictionReport } from './online/prediction';
import { cameraView, type CameraView } from './render/camera';
import type { TerrainReport } from './render/terrain';
import { PIXELS_PER_METRE } from './render/units';
import { MIN_VISIBLE_METRES } from './render/zoom';
import type { HudScene } from './scenes/HudScene';
import type { WorldScene } from './scenes/WorldScene';
import type { PlayableWorld } from './worlds/PlayableWorld';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  /** The live sim solo, the replica online. */
  readonly sim: SimHandle;
  readonly game: Phaser.Game;
  /** The terrain the sim is built on: its areas and its spawn tile. */
  readonly map: WorldMap;
  /** The map's areas resolved into chunks of tile def ids, with its bounds in tiles and its checksum. */
  readonly tiles: MapTiles;
  /** Tiles along one side of a chunk. */
  readonly chunkSize: number;
  /** The sim's own tile/metre conversions, so checks derive positions from content instead of recomputing them. */
  readonly tileAt: typeof tileAt;
  readonly tileCentre: typeof tileCentre;
  /** The tile def id at a world tile, or undefined where no area put a tile. */
  tileDefIdAt(tile: TileCoordinate): number | undefined;
  /** How much terrain is drawn right now: which chunks, how many ground tiles and standing images. Undefined until the world scene runs. */
  terrain(): TerrainReport | undefined;
  /** What the minimap shows right now: where it is on screen, its centre, which chunks it has painted and every marker. Undefined until the HUD scene has drawn it. */
  minimap(): MinimapReport | undefined;
  readonly defs: readonly EntityDef[];
  /** The palettes a character's look indexes into, so checks derive colours from content. */
  readonly characterPalettes: typeof characterPalettes;
  /** Every character in the sim right now (name and look), by entity id. */
  characters(): (Character & { readonly eid: number })[];
  /** The names the renderer draws above characters right now, with where each sits and the texture its character is drawn from. Empty until the world scene runs. */
  drawnNames(): ReturnType<WorldScene['drawnNames']>;
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
  /** The round trip to the server the HUD shows, in milliseconds; undefined until measured and while not seated. */
  latencyMs(): number | undefined;
  /** Updates the replica refused as malformed since the page loaded. */
  malformedUpdates(): number;
  /** Ticks the drawn frame stays behind the newest server state, so checks can derive the expected lag. */
  readonly interpolationBufferTicks: number;
  /** What the local player's prediction is doing (ADR 0012); undefined while there is none (still loading, switched off, failed). */
  prediction(): PredictionReport | undefined;
  /** Where the last frame drew the local player, in metres: predicted when predicting, else from server states. Undefined when it drew none. */
  localPlayerDrawnAt(): { readonly x: number; readonly y: number } | undefined;
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
  const tiles = readMapTiles(sim.map);
  window.__novaland = {
    sim,
    game,
    map: sim.map,
    tiles,
    chunkSize: CHUNK_SIZE,
    tileAt,
    tileCentre,
    tileDefIdAt: (tile) => tileDefIdAt(tiles, tile),
    terrain: () => (game.scene.isActive('world') ? (game.scene.getScene('world') as WorldScene).terrainReport() : undefined),
    minimap: () => (game.scene.isActive('hud') ? (game.scene.getScene('hud') as HudScene).minimapReport() : undefined),
    defs: entityDefs,
    characterPalettes,
    characters: () =>
      getRenderables(sim).flatMap((renderable) => {
        const character = getCharacter(sim, renderable.eid);
        return character ? [{ eid: renderable.eid, ...character }] : [];
      }),
    drawnNames: () => (game.scene.isActive('world') ? (game.scene.getScene('world') as WorldScene).drawnNames() : []),
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
