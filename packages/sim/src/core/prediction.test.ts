import { describe, expect, it } from 'vitest';
import { worldMap } from '../content/world';
import { generatedWorldMap } from '../content/world/generated';
import { features } from '../features';
import { findPlayerEntity } from '../features/player/queries';
import { __testing__, createPrediction, createReplica, createSim } from './create';
import type { Feature } from './feature';
import { __testing__ as physicsTesting, initPhysics } from './physics';
import { adoptEntity, Prediction, releaseAdoptedEntities, type PredictionHandle } from './prediction';
import { applyWorldState, type ReplicaHandle } from './replica';
import type { Sim, SimHandle } from './sim';
import { getRenderables, type Renderable } from './view';
import { worldState, type WorldState } from './worldState';

describe('a prediction', () => {
  it('starts with the same terrain colliders as a sim of the map and no entity at all, and steps like a sim', async () => {
    const prediction = await createPrediction({ map: worldMap });
    const sim = await __testing__.createSimInternal({ seed: 3, map: worldMap });
    expect(prediction.isPrediction).toBe(true);
    expect(prediction.entityCount).toBe(0);
    expect(staticBoxes(prediction as unknown as Sim).length).toBeGreaterThan(10);
    expect(staticBoxes(prediction as unknown as Sim)).toEqual(staticBoxes(sim));
    expect(getRenderables(prediction)).toEqual([]);
    prediction.step();
    expect(prediction.tick).toBe(1);
  });

  it('takes no entity id for terrain, however big the map: the first id a server hands a player is free to adopt', async () => {
    for (const map of [worldMap, generatedWorldMap({ columns: 400, rows: 300 })]) {
      const server = await createSim({ seed: 5, map });
      server.step([{ type: 'player/join', slot: 0 }]);
      const replica = createReplica({ map, capacity: server.capacity });
      applyWorldState(replica, worldState(server));
      const prediction = await createPrediction({ map, capacity: server.capacity });
      expect(prediction.entityCount).toBe(0);
      const eid = findPlayerEntity(replica, 0) as number;
      // The lowest id there is: before terrain left the entities, a prediction used it for a tree and refused the player.
      expect(eid).toBe(1);
      expect(adoptEntity(prediction, replica, eid)).toBe(true);
      expect(prediction.entityCount).toBe(1);
      for (const handle of [server, replica, prediction]) handle.destroy();
    }
  });

  it('refuses an id a feature of the prediction spawned by itself, and leaves that entity alone', async () => {
    const { replica } = await serverReplicaAndPrediction();
    await initPhysics();
    const spawnsOneEntity: Feature = { name: 'spawner', init: (sim) => void sim.createEntity() };
    const prediction = new Prediction({ seed: 0, map: worldMap, capacity: replica.capacity }, [spawnsOneEntity, ...features]);
    const ownId = 1;
    expect(findPlayerEntity(replica, 0)).toBe(ownId);
    expect(adoptEntity(prediction, replica, ownId)).toBe(false);
    expect(prediction.entityCount).toBe(1);
    expect(findPlayerEntity(prediction, 0)).toBeUndefined();
    releaseAdoptedEntities(prediction);
    expect(prediction.entityCount).toBe(1);
  });

  it('refuses a capacity out of range before loading anything', async () => {
    await expect(createPrediction({ map: worldMap, capacity: 0 })).rejects.toThrow(RangeError);
    await expect(createPrediction({ map: worldMap, capacity: 1e9 })).rejects.toThrow(RangeError);
  });

  it('adopts a player from a replica under the same id and walks it exactly as the server does, walls included', async () => {
    const { server, replica, prediction } = await serverReplicaAndPrediction();
    const eid = findPlayerEntity(replica, 0) as number;
    expect(adoptEntity(prediction, replica, eid)).toBe(true);
    expect(findPlayerEntity(prediction, 0)).toBe(eid);
    expect(renderableOf(prediction, eid)).toEqual(renderableOf(server, eid));
    // Far enough west to run into the trees at the edge of the clearing: the prediction must stop where the server stops.
    const move = { type: 'player/move', slot: 0, x: -1, y: 0.3 } as const;
    server.step([move]);
    prediction.step([move]);
    for (let tick = 0; tick < 600; tick += 1) {
      server.step();
      prediction.step();
    }
    const predicted = renderableOf(prediction, eid);
    const authoritative = renderableOf(server, eid);
    expect(Math.abs(predicted.x - renderableOf(replica, eid).x)).toBeGreaterThan(2);
    expect(predicted.x).toBeCloseTo(authoritative.x, 6);
    expect(predicted.y).toBeCloseTo(authoritative.y, 6);
  });

  it('adopting again replaces what the prediction guessed with what the server says', async () => {
    const { server, replica, prediction } = await serverReplicaAndPrediction();
    const eid = findPlayerEntity(replica, 0) as number;
    adoptEntity(prediction, replica, eid);
    prediction.step([{ type: 'player/move', slot: 0, x: 1, y: 0 }]);
    for (let tick = 0; tick < 30; tick += 1) prediction.step();
    expect(renderableOf(prediction, eid).x).not.toBeCloseTo(renderableOf(server, eid).x, 3);
    const entitiesBefore = prediction.entityCount;
    expect(adoptEntity(prediction, replica, eid)).toBe(true);
    expect(prediction.entityCount).toBe(entitiesBefore);
    expect(renderableOf(prediction, eid)).toEqual(renderableOf(server, eid));
    for (let tick = 0; tick < 30; tick += 1) prediction.step();
    expect(renderableOf(prediction, eid)).toEqual(renderableOf(server, eid));
  });

  it('holds only what was adopted: other players stay out, and releasing removes the adopted one', async () => {
    const { replica, prediction } = await serverReplicaAndPrediction();
    const eid = findPlayerEntity(replica, 0) as number;
    adoptEntity(prediction, replica, eid);
    expect(prediction.entityCount).toBe(1);
    expect(findPlayerEntity(prediction, 1)).toBeUndefined();
    releaseAdoptedEntities(prediction);
    expect(prediction.entityCount).toBe(0);
    expect(findPlayerEntity(prediction, 0)).toBeUndefined();
    prediction.step();
  });

  it('refuses, without throwing and without keeping anything, an entity it cannot give a body to', async () => {
    const { server, replica, prediction } = await serverReplicaAndPrediction();
    const eid = findPlayerEntity(replica, 0) as number;
    const refused: Array<[string, (state: WorldState) => number]> = [
      ['an id the source does not have', () => 999],
      ['an id that is not one', () => -1],
      ['a def that does not exist', (state) => edit(state, eid, 'DefRef', { id: 987654 })],
      ['no def at all', (state) => remove(state, eid, 'DefRef')],
      ['a position no level reaches', (state) => edit(state, eid, 'Position', { x: 1e300, y: 0 })],
      ['a radius that is not positive', (state) => edit(state, eid, 'Extents', { halfWidth: 0, halfHeight: 0 })],
      ['a radius far too large', (state) => edit(state, eid, 'Extents', { halfWidth: 1e9, halfHeight: 1e9 })],
      ['no position', (state) => remove(state, eid, 'Position')],
      ['no player component', (state) => remove(state, eid, 'Player')],
    ];
    for (const [what, prepare] of refused) {
      // Adopted first, so a refusal of the same id also has to let go of what was there.
      applyWorldState(replica, worldState(server));
      expect(adoptEntity(prediction, replica, eid), what).toBe(true);
      const state = JSON.parse(JSON.stringify(worldState(server))) as WorldState;
      const id = prepare(state);
      applyWorldState(replica, state);
      expect(adoptEntity(prediction, replica, id), what).toBe(false);
      if (id === eid) expect(prediction.entityCount, what).toBe(0);
      prediction.step();
      releaseAdoptedEntities(prediction);
      expect(prediction.entityCount, what).toBe(0);
    }
  });

  it('only adopts into a prediction: a sim a server steps and a replica are refused loudly', async () => {
    const { server, replica } = await serverReplicaAndPrediction();
    const eid = findPlayerEntity(replica, 0) as number;
    expect(() => adoptEntity(server as unknown as PredictionHandle, replica, eid)).toThrow(TypeError);
    expect(() => adoptEntity(replica as unknown as PredictionHandle, replica, eid)).toThrow(TypeError);
    expect(() => releaseAdoptedEntities(server as unknown as PredictionHandle)).toThrow(TypeError);
  });

  it('leaves a sim the server steps untouched: the same seed and commands give the same hash with a prediction running beside it', async () => {
    const alone = await __testing__.createSimInternal({ seed: 9 });
    const beside = await __testing__.createSimInternal({ seed: 9 });
    const prediction = await createPrediction({ map: worldMap });
    const replica = createReplica({ map: worldMap });
    for (const sim of [alone, beside]) sim.step([{ type: 'player/join', slot: 0 }]);
    for (let tick = 0; tick < 120; tick += 1) {
      const commands = tick % 40 === 0 ? [{ type: 'player/move', slot: 0, x: Math.cos(tick), y: Math.sin(tick) } as const] : [];
      alone.step(commands);
      beside.step(commands);
      applyWorldState(replica, worldState(beside));
      adoptEntity(prediction, replica, findPlayerEntity(replica, 0) as number);
      prediction.step(commands);
    }
    expect(JSON.stringify(beside.snapshot())).toBe(JSON.stringify(alone.snapshot()));
  });
});

// ---- Helpers ----

const { staticBoxes } = physicsTesting;

/** A server sim with two players, a replica holding its state and an empty prediction of the same map. */
async function serverReplicaAndPrediction(): Promise<{ server: SimHandle; replica: ReplicaHandle; prediction: PredictionHandle }> {
  const server = await createSim({ seed: 5, map: worldMap });
  server.step([
    { type: 'player/join', slot: 0 },
    { type: 'player/join', slot: 1 },
  ]);
  const replica = createReplica({ map: worldMap, capacity: server.capacity });
  applyWorldState(replica, worldState(server));
  const prediction = await createPrediction({ map: worldMap, capacity: server.capacity });
  return { server, replica, prediction };
}

function renderableOf(handle: SimHandle, eid: number): Renderable {
  const renderable = getRenderables(handle).find((candidate) => candidate.eid === eid);
  if (!renderable) throw new Error(`entity ${eid} is not drawn`);
  return renderable;
}

function edit(state: WorldState, eid: number, component: string, fields: Record<string, number>): number {
  const entity = state.entities.find((candidate) => candidate.id === eid);
  if (entity) entity.components[component] = fields;
  return eid;
}

function remove(state: WorldState, eid: number, component: string): number {
  const entity = state.entities.find((candidate) => candidate.id === eid);
  if (entity) delete entity.components[component];
  return eid;
}
