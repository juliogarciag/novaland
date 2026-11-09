/**
 * Public API of the simulation.
 *
 * The client and the server import ONLY from this file. Everything else in
 * packages/sim/src is internal. Add an export here when a feature needs to
 * expose something to a view or a server.
 */
export { createReplica, createSim, type ReplicaOptions, type SimOptions } from './core/create';
export type { SimHandle } from './core/sim';
export type { Command } from './core/commands';
export { DEFAULT_SEND_RATE, FIXED_DT, TICK_RATE } from './content/tuning';
export { hashSnapshot, type EntitySnapshot, type SimSnapshot } from './core/snapshot';
export {
  applyWorldState,
  applyWorldStateDelta,
  diffWorldState,
  worldState,
  type EntityDelta,
  type WorldState,
  type WorldStateApplyResult,
  type WorldStateDelta,
  type WorldStateUpdate,
} from './core/worldState';
export { WIRE, type MoveMessage, type WelcomeMessage } from './core/wire';
export { getRenderables, type Renderable } from './core/view';
export { DefId, entityDefs, getDef, type EntityDef } from './content/defs';
export type { DirectionalFrames, FrameRange, SpriteDef, SpriteDirection } from './content/sprites';
export { starterLevel } from './content/levels/starter';
export { findLevel, levels } from './content/levels';
export type { LevelData, TileCoordinate, TileGrid } from './content/levels/types';
export { readTileGrid, spawnPoint, tileAt, tileCentre } from './content/levels/grid';
export { getTileDef, terrainDefs, TILE_SIZE, type TileDef } from './features/terrain/defs';
export type { JoinCommand, LeaveCommand, MoveCommand, PlayerCommand } from './features/player/commands';
export { findPlayerEntity, getHeading, type Heading } from './features/player/queries';
