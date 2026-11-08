import { addComponent, query } from 'bitecs';
import { getDef } from '../../content/defs';
import { DEFAULT_RADIUS, MAX_PLAYER_SLOTS } from '../../content/tuning';
import type { Command } from '../../core/commands';
import type { Feature } from '../../core/feature';
import { attachDynamicBall, Body } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { DefRef, Extents } from '../../core/transform';
import { MoveIntent, Player } from './components';
import { PlayerDefId } from './defs';
import { findPlayerEntity } from './queries';

/**
 * Player-controlled bodies. A `player/join` spawns one at the level spawn
 * point, `player/move` sets its intended direction and every tick the intent
 * becomes a velocity. Walls stop it through physics, not through code here.
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

function spawnPlayer(sim: Sim, slot: number): number {
  const def = getDef(PlayerDefId.Player);
  const radius = def.radius ?? DEFAULT_RADIUS;
  const eid = sim.createEntity();
  const player = sim.store(Player);
  const intent = sim.store(MoveIntent);
  const defRef = sim.store(DefRef);
  const extents = sim.store(Extents);
  addComponent(sim.world, eid, player);
  addComponent(sim.world, eid, intent);
  addComponent(sim.world, eid, defRef);
  addComponent(sim.world, eid, extents);
  player.slot[eid] = slot;
  intent.x[eid] = 0;
  intent.y[eid] = 0;
  defRef.id[eid] = def.id;
  extents.halfWidth[eid] = radius;
  extents.halfHeight[eid] = radius;
  attachDynamicBall(sim, eid, { x: sim.level.spawn.x, y: sim.level.spawn.y, radius });
  return eid;
}

function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < MAX_PLAYER_SLOTS;
}

/** Rejects non-finite input, clamps each component to [-1, 1], then scales anything longer than 1 down to unit length. */
function clampToUnit(x: unknown, y: unknown): { x: number; y: number } {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const clampedX = Math.min(1, Math.max(-1, x));
  const clampedY = Math.min(1, Math.max(-1, y));
  const length = Math.hypot(clampedX, clampedY);
  if (length <= 1) return { x: clampedX, y: clampedY };
  return { x: clampedX / length, y: clampedY / length };
}
