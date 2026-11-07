import { addComponent, query } from 'bitecs';
import { DefId, getDef } from '../../content/defs';
import type { Command } from '../../core/commands';
import type { Feature } from '../../core/feature';
import { attachDynamicBall, Body } from '../../core/physics';
import type { Sim } from '../../core/sim';
import { DefRef, Extents } from '../../core/transform';
import { MoveIntent, Player } from './components';
import { findPlayerEntity } from './queries';

const MAX_SLOTS = 64;

/**
 * Player-controlled bodies. A `join` spawns one at the level spawn point,
 * `move` sets its intended direction and every tick the intent becomes a
 * velocity. Walls stop it through physics, not through code here.
 */
export const playerFeature: Feature = {
  name: 'player',

  handleCommand(sim, command: Command) {
    switch (command.type) {
      case 'join':
        if (isValidSlot(command.slot) && findPlayerEntity(sim, command.slot) === undefined) {
          spawnPlayer(sim, command.slot);
        }
        return;
      case 'leave': {
        const eid = isValidSlot(command.slot) ? findPlayerEntity(sim, command.slot) : undefined;
        if (eid !== undefined) sim.destroyEntity(eid);
        return;
      }
      case 'move': {
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

export function spawnPlayer(sim: Sim, slot: number): number {
  const def = getDef(DefId.Player);
  const radius = def.radius ?? 0.5;
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
  extents.hw[eid] = radius;
  extents.hh[eid] = radius;
  attachDynamicBall(sim, eid, sim.level.spawn.x, sim.level.spawn.y, radius);
  return eid;
}

function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < MAX_SLOTS;
}

/** Rejects NaN/Infinity and scales anything longer than 1 down to unit length. */
function clampToUnit(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}
