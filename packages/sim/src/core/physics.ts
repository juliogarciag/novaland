import type RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { RigidBody, World as PhysicsWorld } from '@dimforge/rapier2d-deterministic-compat';
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
 * the same bytes on every platform (replays, desync checks between a server
 * and its tests). See docs/decisions/0002-physics.md; multiplayer itself is
 * server-authoritative, see 0004-multiplayer-netcode.md.
 */

type Rapier = typeof RAPIER;

let ready: Promise<void> | undefined;
let rapierModule: Rapier | undefined;

/**
 * Loads the Rapier WASM module once per process. createSim awaits this for you.
 *
 * Rapier arrives through a dynamic import, so a bundle that never creates a
 * sim never fetches it: a production client only holds a replica of the
 * server's world, and Rapier's inlined WASM is most of what it would
 * otherwise download.
 */
export function initPhysics(): Promise<void> {
  ready ??= import('@dimforge/rapier2d-deterministic-compat').then(
    async ({ default: rapier }) => {
      await rapier.init();
      rapierModule = rapier;
    },
    (error: unknown) => {
      // A chunk that failed to fetch (offline, a redeploy) is not cached: the next createSim tries again.
      ready = undefined;
      throw error;
    },
  );
  return ready;
}

/** Rapier, loaded. Every caller runs inside a sim, and a sim only exists once initPhysics has finished. */
function loadedRapier(): Rapier {
  if (!rapierModule) throw new Error('Rapier is not loaded: await initPhysics() before creating a sim');
  return rapierModule;
}

export function createPhysicsWorld(dt: number): PhysicsWorld {
  const world = new (loadedRapier().World)({ x: 0, y: 0 });
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

export interface BallBodyOptions {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** A moving body that never rotates and never tunnels through thin walls. */
export function attachDynamicBall(sim: Sim, eid: number, { x, y, radius }: BallBodyOptions): RigidBody {
  const rapier = loadedRapier();
  const bodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true);
  const rigidBody = sim.physics.createRigidBody(bodyDesc);
  sim.physics.createCollider(rapier.ColliderDesc.ball(radius).setFriction(0).setRestitution(0), rigidBody);
  register(sim, eid, rigidBody);
  return rigidBody;
}

export interface BoxBodyOptions {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/** An immovable body: terrain and other obstacles. */
export function attachStaticBox(sim: Sim, eid: number, { x, y, halfWidth, halfHeight }: BoxBodyOptions): RigidBody {
  const rapier = loadedRapier();
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = sim.physics.createRigidBody(bodyDesc);
  sim.physics.createCollider(rapier.ColliderDesc.cuboid(halfWidth, halfHeight).setFriction(0), rigidBody);
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
  const translation = rigidBody.translation();
  position.x[eid] = translation.x;
  position.y[eid] = translation.y;
}

/** Copies every body's translation into its Position component. Runs after each physics step. */
export function syncBodiesToPositions(sim: Sim): void {
  const body = sim.store(Body);
  const position = sim.store(Position);
  for (const eid of query(sim.world, [body, position])) {
    const rigidBody = sim.physics.getRigidBody(body.handle[eid] as number);
    if (!rigidBody) continue;
    const translation = rigidBody.translation();
    position.x[eid] = translation.x;
    position.y[eid] = translation.y;
  }
}
