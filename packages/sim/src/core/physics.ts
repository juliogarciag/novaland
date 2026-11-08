import RAPIER, { type RigidBody, type World as PhysicsWorld } from '@dimforge/rapier2d-deterministic-compat';
import { addComponent, hasComponent, query } from 'bitecs';
import { defineComponent, f64 } from './components';
import type { Sim } from './sim';
import { Position } from './transform';

/**
 * Physics lives in the sim and nowhere else. Rapier owns bodies and
 * colliders; the ECS keeps a handle to each body in the Body component and
 * mirrors body translations into Position after every step.
 *
 * We use the `deterministic` build of Rapier so that the same inputs produce
 * the same bytes on every platform (needed for lockstep networking and
 * replays). See docs/decisions/0002-physics.md.
 */

let ready: Promise<void> | undefined;

/** Loads the Rapier WASM module once per process. createSim awaits this for you. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init().then(() => undefined);
  return ready;
}

export function createPhysicsWorld(dt: number): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = dt;
  return world;
}

/** Handle of the Rapier rigid body owned by this entity. */
export const Body = defineComponent('Body', (capacity) => ({
  handle: f64(capacity),
}));

export function getBody(sim: Sim, eid: number): RigidBody | null {
  const body = sim.store(Body);
  if (!hasComponent(sim.world, eid, body)) return null;
  return sim.physics.getRigidBody(body.handle[eid] as number);
}

export function attachDynamicBall(sim: Sim, eid: number, x: number, y: number, radius: number): RigidBody {
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true);
  const rigidBody = sim.physics.createRigidBody(desc);
  sim.physics.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0).setRestitution(0), rigidBody);
  register(sim, eid, rigidBody);
  return rigidBody;
}

export function attachStaticBox(sim: Sim, eid: number, x: number, y: number, halfWidth: number, halfHeight: number): RigidBody {
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = sim.physics.createRigidBody(desc);
  sim.physics.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight).setFriction(0), rigidBody);
  register(sim, eid, rigidBody);
  return rigidBody;
}

/** Removes the entity's rigid body (and its colliders) from the physics world, if it has one. */
export function detachBody(sim: Sim, eid: number): void {
  const rigidBody = getBody(sim, eid);
  if (rigidBody) sim.physics.removeRigidBody(rigidBody);
}

function register(sim: Sim, eid: number, rigidBody: RigidBody): void {
  const body = sim.store(Body);
  const position = sim.store(Position);
  addComponent(sim.world, eid, body);
  addComponent(sim.world, eid, position);
  body.handle[eid] = rigidBody.handle;
  const t = rigidBody.translation();
  position.x[eid] = t.x;
  position.y[eid] = t.y;
}

/** Copies every body's translation into its Position component. Runs after each physics step. */
export function syncBodiesToPositions(sim: Sim): void {
  const body = sim.store(Body);
  const position = sim.store(Position);
  for (const eid of query(sim.world, [body, position])) {
    const rigidBody = sim.physics.getRigidBody(body.handle[eid] as number);
    if (!rigidBody) continue;
    const t = rigidBody.translation();
    position.x[eid] = t.x;
    position.y[eid] = t.y;
  }
}
