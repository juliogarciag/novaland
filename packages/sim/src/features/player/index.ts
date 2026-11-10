import { addComponent, query } from 'bitecs';
import { getDef } from '../../content/defs';
import { DEFAULT_RADIUS, MAX_PLAYER_SLOTS } from '../../content/tuning';
import type { Command } from '../../core/commands';
import type { Feature } from '../../core/feature';
import { attachDynamicBall, Body } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { DefRef, Extents } from '../../core/transform';
import { pickAvatarDefId } from './avatars';
import { Facing, MoveIntent, Player } from './components';
import { MIN_MOVE_INTENT } from './defs';
import { findPlayerEntity } from './queries';
import { pickSpawnPoint } from './spawn';

/** Players spawn looking down the screen (y points down). */
const SPAWN_FACING = { x: 0, y: 1 } as const;

/**
 * Rapier interaction groups: the upper 16 bits are the layers a collider
 * belongs to, the lower 16 the layers it touches. Players sit in their own
 * layer and touch every layer but that one, so two players pass through
 * each other (the paths are two tiles wide and a standing player would
 * otherwise block them) while terrain, which keeps Rapier's default of
 * every layer, still stops them.
 */
const PLAYER_LAYER = 1 << 0;
const PLAYER_COLLISION_GROUPS = (PLAYER_LAYER << 16) | (0xffff & ~PLAYER_LAYER);

/**
 * Player-controlled bodies. A `player/join` dresses the new player in an
 * avatar the sim picks (never the client) and spawns it on a free tile near
 * the level spawn, `player/move` sets its intended direction and every tick
 * the intent becomes a velocity. A non-zero intent also turns the player to
 * face that way (the clamped intent, so an oversized command faces its
 * clamped direction), and the facing outlives the movement so a stopped
 * player keeps looking where it last walked. Terrain stops it through
 * physics, not through code here; other players do not.
 *
 * Handlers are the validation boundary: commands will arrive from the
 * network one day, so anything malformed is ignored, never thrown on.
 */
export const playerFeature: Feature = {
  name: 'player',

  handleCommand(sim, command: Command) {
    switch (command.type) {
      case 'player/join':
        if (isValidSlot(command.slot) && !sim.isFull && findPlayerEntity(sim, command.slot) === undefined) {
          spawnPlayer(sim, command.slot);
        }
        return;
      case 'player/leave': {
        const eid = isValidSlot(command.slot) ? findPlayerEntity(sim, command.slot) : undefined;
        if (eid !== undefined) sim.destroyEntity(eid);
        return;
      }
      case 'player/move': {
        const eid = isValidSlot(command.slot) ? findPlayerEntity(sim, command.slot) : undefined;
        if (eid === undefined) return;
        const intent = sim.store(MoveIntent);
        const { x, y } = clampToUnit(command.x, command.y);
        intent.x[eid] = x;
        intent.y[eid] = y;
        if (x !== 0 || y !== 0) {
          const facing = sim.store(Facing);
          const length = Math.hypot(x, y);
          facing.x[eid] = x / length;
          facing.y[eid] = y / length;
        }
        return;
      }
    }
  },

  update(sim) {
    const player = sim.store(Player);
    const intent = sim.store(MoveIntent);
    const body = sim.store(Body);
    const defRef = sim.store(DefRef);
    for (const eid of query(sim.world, [player, intent, body, defRef])) {
      const rigidBody = sim.physics.getRigidBody(body.handle[eid] as number);
      if (!rigidBody) continue;
      const speed = getDef(defRef.id[eid] as number).speed ?? 0;
      rigidBody.setLinvel({ x: (intent.x[eid] as number) * speed, y: (intent.y[eid] as number) * speed }, true);
    }
  },
};

/** The avatar and the spawn point are both picked before the entity exists, so the new player never counts as present for its own choices. */
function spawnPlayer(sim: Sim, slot: number): number {
  const def = getDef(pickAvatarDefId(sim));
  const spawn = pickSpawnPoint(sim);
  const radius = def.radius ?? DEFAULT_RADIUS;
  const eid = sim.createEntity();
  const player = sim.store(Player);
  const intent = sim.store(MoveIntent);
  const facing = sim.store(Facing);
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  addComponent(sim.world, eid, player);
  addComponent(sim.world, eid, intent);
  addComponent(sim.world, eid, facing);
  addComponent(sim.world, eid, defRef);
  addComponent(sim.world, eid, extents);
  player.slot[eid] = slot;
  intent.x[eid] = 0;
  intent.y[eid] = 0;
  facing.x[eid] = SPAWN_FACING.x;
  facing.y[eid] = SPAWN_FACING.y;
  defRef.id[eid] = def.id;
  extents.halfWidth[eid] = radius;
  extents.halfHeight[eid] = radius;
  const rigidBody = attachDynamicBall(sim, eid, { x: spawn.x, y: spawn.y, radius });
  for (let index = 0; index < rigidBody.numColliders(); index += 1) rigidBody.collider(index).setCollisionGroups(PLAYER_COLLISION_GROUPS);
  return eid;
}

function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < MAX_PLAYER_SLOTS;
}

/**
 * Rejects non-finite input, clamps each component to [-1, 1], then scales
 * anything longer than 1 down to unit length. Anything shorter than
 * MIN_MOVE_INTENT is a stop, so the facing is only ever derived from a
 * vector long enough to normalise exactly.
 */
function clampToUnit(x: unknown, y: unknown): { x: number; y: number } {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const clampedX = Math.min(1, Math.max(-1, x));
  const clampedY = Math.min(1, Math.max(-1, y));
  const length = Math.hypot(clampedX, clampedY);
  if (length < MIN_MOVE_INTENT) return { x: 0, y: 0 };
  if (length <= 1) return { x: clampedX, y: clampedY };
  return { x: clampedX / length, y: clampedY / length };
}

export const __testing__ = { PLAYER_COLLISION_GROUPS };
