/**
 * Public API of the simulation.
 *
 * The client and the server import ONLY from this file. Everything else in
 * packages/sim/src is internal. Add an export here when a feature needs to
 * expose something to a view or a server.
 */
export { createSim, type SimOptions } from './core/create';
export type { SimHandle } from './core/sim';
export type { Command } from './core/commands';
export { FIXED_DT, TICK_RATE } from './content/tuning';
export { hashSnapshot, type EntitySnapshot, type SimSnapshot } from './core/snapshot';
export { getRenderables, type Renderable } from './core/view';
export { DefId, entityDefs, getDef, type EntityDef } from './content/defs';
export type { DirectionalFrames, FrameRange, SpriteDef, SpriteDirection } from './content/sprites';
export { starterLevel } from './content/levels/starter';
export type { LevelData, WallData } from './content/levels/types';
export type { JoinCommand, LeaveCommand, MoveCommand, PlayerCommand } from './features/player/commands';
export { findPlayerEntity, getHeading, type Heading } from './features/player/queries';
