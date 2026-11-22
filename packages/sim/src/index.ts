/**
 * Public API of the simulation.
 *
 * The client and the server import ONLY from this file. Everything else in
 * packages/sim/src is internal. Add an export here when a feature needs to
 * expose something to a view or a server.
 */
export { createPrediction, createReplica, createSim, type PredictionOptions, type ReplicaOptions, type SimOptions } from './core/create';
export { adoptEntity, releaseAdoptedEntities, type PredictionHandle } from './core/prediction';
export type { SimHandle } from './core/sim';
export type { Command } from './core/commands';
export { FIXED_DT, MAX_PLAYER_SLOTS, TICK_RATE } from './content/tuning';
export { hashSnapshot, type EntitySnapshot, type SimSnapshot } from './core/snapshot';
export { applyWorldStateDelta, diffWorldState, worldState, type EntityDelta, type WorldState, type WorldStateDelta, type WorldStateUpdate } from './core/worldState';
export { applyWorldState, type ReplicaHandle, type WorldStateApplyResult } from './core/replica';
export { DEFAULT_SEND_RATE, isPlayerToken, JOIN_REFUSAL, WIRE, WIRE_PROTOCOL, type JoinOptions, type MoveAppliedMessage, type ChangeCharacterMessage, type MoveMessage, type WelcomeMessage } from './core/wire';
export { getRenderables, type Renderable } from './core/view';
export { DefId, entityDefs, getDef, type EntityDef } from './content/defs';
export type { MinimapMarker, MinimapMarkerShape } from './content/minimap';
export type { DirectionalFrames, FrameRange, SpriteDef, SpriteDirection } from './content/sprites';
export { worldMap } from './content/world';
export { mapLandmarks, type Landmark } from './content/world/landmarks';
export { generatedWorldMap, type GeneratedMapOptions } from './content/world/generated';
export { regionMapSpawningNear, regions, tileOfCoordinates } from './content/world/regions';
export type { EarthCoordinates, Region, RegionGrid, RegionSource } from './content/world/regions/types';
export type { AreaData, MapChunk, MapTiles, TileCoordinate, TileRectangle, WorldMap } from './content/world/types';
export { CHUNK_SIZE, NO_TILE, WORLD_LIMIT_TILES, chunkCoordinateOf, findChunk, readMapTiles, spawnPoint, tileAt, tileCentre, tileDefIdAt } from './content/world/tiles';
export { EDGE_SHAPES, EdgeNeighbour, edgeShapeOf, getTileDef, terrainDefs, TILE_SIZE, type GroundTileSprite, type StandingTileSprite, type TileDef } from './features/terrain/defs';
export type { ChangeCharacterCommand, JoinCommand, LeaveCommand, MoveCommand, PlayerCommand } from './features/player/commands';
export { findPlayerEntity, getCharacter, getHeading, getPlayerPosition, type Heading } from './features/player/queries';
export { guestCharacter, readCharacter, readCharacterName, readRememberedCharacter, sameCharacter, type Character, type CharacterLook, type CharacterNameProblem } from './features/player/character';
export {
  CHARACTER_PARTS,
  CHARACTER_SHAPE_PARTS,
  characterPalettes,
  characterShapes,
  DEFAULT_LOOK,
  isPlayerDefId,
  LOOK_PARTS,
  MAX_NAME_CHARACTERS,
  type CharacterPart,
  type CharacterShapePart,
  type GenderChoice,
  type LookPart,
  type PaletteSwatch,
  type ShapeChoice,
} from './features/player/defs';
