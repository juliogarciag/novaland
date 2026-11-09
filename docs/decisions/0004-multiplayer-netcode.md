# 0004 - Multiplayer netcode: an authoritative server and replica clients

Status: accepted. Date: 2026-11-09.

## Context

Novaland becomes one shared world: a single room, five seats, anyone joins with a random avatar. The sim (`packages/sim`) is already headless and deterministic (ADR 0001, 0002), and views only hold a `SimHandle` (AGENTS.md rule 2). Many agents add features in parallel, and none of them should have to know that multiplayer exists: if a view query works on a local sim, it has to work on remote state too.

Two designs were on the table:

- **Lockstep**: every client runs the sim and only inputs travel. Rejected. JavaScript `Math.*` (`hypot`, `sin`, trig in general) is not bit-identical across engines, so two browsers would drift even with the deterministic Rapier build; one feature with a hidden source of nondeterminism from a parallel agent would desync everybody; and a late joiner would need a full restore of a live sim (ticket #2), which does not exist yet.
- **Authoritative server**: one Node process owns the only `Sim` and steps it; clients send inputs and draw what the server says. Chosen.

## Decision

### One sim, many replicas

- The server (ticket #17) creates the one `Sim` with `createSim` and is the only thing that calls `step`. Clients send commands; the server stamps the seat and feeds them to the sim.
- A client (ticket #18) holds a **replica**: `createReplica({ level, capacity })` returns a `ReplicaHandle` (a `SimHandle` plus `isReplica` and `hasState`) with entities and components but no physics, rng or features. `applyWorldState(replica, update)` writes what the server sent into it and is the only thing that does; it takes a `ReplicaHandle`, so handing it a live sim is a compile error (and a `TypeError` at runtime). The existing view queries (`getRenderables`, `getHeading`, `findPlayerEntity`) read a replica exactly as they read a live sim, because they go through the internal `EntityWorld` (world + component stores) that both provide. Entity ids on a replica are the server's ids: bitECS cannot be told which id to allocate, but without versioning it recycles ids deterministically, so `core/restore.ts` allocates until the wanted ids come out and frees the rest (`restore.test.ts` checks this against a model).
- A replica never advances by itself: `replica.step()` **throws**. A no-op would silently freeze the world in a view that mixed up its modes; the throw surfaces the bug the first time it runs. `replica.snapshot()` returns the entities and the tick with empty `physics` and `rng: 0`, and `replica.seed` is 0, so the debug hooks keep working online.
- **No client-side prediction in v1.** Input goes to the server and comes back as state; a walk-around world tolerates the round trip. Prediction and reconciliation would need the client to run the sim from a restored state, which rides on #2 and is a later ticket.

### World state and deltas (`core/worldState.ts`)

- `worldState(handle)` is the `entities` part of `sim.snapshot()` plus the tick: `{ kind: 'full', tick, entities }`. No physics bytes, no rng: a replica has nothing to do with them. It is plain JSON, with entities sorted by id and components and fields sorted by name.
- `diffWorldState(previous, next)` returns `{ kind: 'delta', fromTick, tick, changed, removed }`. `changed` holds one `{ id, components, removedComponents? }` per entity that changed, carrying **whole components** (every field) for each component that changed or appeared, and the names of components it lost; a new entity carries all of its components. `removed` lists the ids that no longer exist. Static entities (terrain) travel once, in the full state; five walking players cost a few hundred bytes per delta.
- `applyWorldStateDelta(state, delta)` is the pure form: the next `WorldState`, or `undefined` when the delta does not continue from `state.tick`. It validates both arguments like `applyWorldState` does and yields what a replica would hold after the same delta. It is for tooling and tests that work on recorded states and deltas (replays, desync diagnosis); views never read a `WorldState`'s entities, see "Interpolation" below.
- `applyWorldState(replica, update)` takes either kind and answers `'applied'`, `'out-of-sequence'` (a delta whose `fromTick` is not the replica's tick, or any delta before the first full state; the replica is untouched and the client must ask for a full state) or `'malformed'`. A full state replaces everything whatever its tick, because the server may have restarted, and sets `hasState`.
- Network data is validated at this boundary and in `core/restore.ts`: wrong top-level shape is refused; entries without an integer id in `1..capacity`, unknown component names, unknown fields and values that are not finite numbers are skipped, never thrown on. A `DefRef` pointing at no def is left out of `getRenderables` for the same reason. The capacity itself arrives in `welcome`, so `createReplica` refuses anything but an integer in `1..MAX_CAPACITY` (`content/tuning.ts`) with a `RangeError`: it bounds what a bad server can make a client allocate and scan.

- `core/restore.ts` holds the shared "write snapshot fields into component stores" code (`ensureEntityExists`, `writeEntityComponents`, `restoreEntity`). Restoring a saved snapshot into a live sim (#2) builds on it and adds the physics world and the rng.

### Interpolation (client, ticket #18)

Deltas arrive at the send rate, frames are drawn at 60 Hz. The client keeps **one replica** and interpolates in view space: before each `applyWorldState` it keeps `getRenderables(replica)` (and the headings it needs) as the previous frame of reference, after it reads them again, and it draws each `eid` between the two by the time elapsed since the update. That is view-only math on `Renderable`s; the client never reads `WorldState.entities` by component name (AGENTS.md rule 8), so a feature that adds a component changes nothing in the client.

### Wire messages (`core/wire.ts`)

Transport is Colyseus (one room, `maxClients` 5, joined by id, never `joinOrCreate`); the message names (`WIRE`), the refusal reasons (`JOIN_REFUSAL`), the default send rate (`DEFAULT_SEND_RATE`) and the payload types are exported from the sim so the server and the client are built against one definition. The sim is the one package both may import, and the file holds no transport. Payloads are plain JSON. The seat a client gets is its `slot`: the same number the player feature and every command use.

| Direction | Name | Payload | When |
|---|---|---|---|
| client → server | join (the Colyseus join itself) | none | On connect. A full room refuses the join with reason `JOIN_REFUSAL.worldFull` (`'world-full'`). |
| server → client | `world/welcome` | `WelcomeMessage` `{ slot, level, capacity, state }` | Once, when the join is accepted. `slot` is the client's seat, `level` the level name, `state` a full `WorldState` taken **after the tick that processed the client's `player/join`**, so `findPlayerEntity(replica, slot)` finds the client's own entity in it. The client resolves the level with `findLevel(level)` and the capacity with `createReplica({ level, capacity })`; an unknown level name or a refused capacity means the client cannot play on this server and treats the join as refused. |
| client → server | `player/move` | `MoveMessage` `{ x, y }` | When the player's direction changes. **No slot**: the server stamps the client's slot and forwards `{ type: 'player/move', slot, x, y }` to the sim. A slot in the payload is ignored. Anything that is not an allow-listed message is dropped. |
| server → client | `world/delta` | `WorldStateDelta` | At the send rate: `DEFAULT_SEND_RATE` (20 per second) unless the server is configured otherwise. Each delta is diffed from the state the server last sent to **that** client, so deltas chain. |
| server → client | `world/state` | `WorldState` | On `world/resync`, and whenever the server cannot continue a client's sequence. |
| client → server | `world/resync` | none | After `applyWorldState` answered `'out-of-sequence'`. |

On disconnect the server sends `player/leave` for the slot to the sim and frees the seat.

## Consequences

- State replication is feature-agnostic: a new component is replicated as soon as it is defined, and a new view query works online if it reads through the sim's public exports. Input is not yet: each new player-facing command (`coins/drop`) needs a `WIRE` entry, a line in the server's allow-list and client code that sends it, which is cross-package work per feature. A generic command envelope (one message carrying any `Command` without its slot, allow-listed by `type`) is the likely next step once a second command exists; until then `core/wire.ts` and the server allow-list are the two extra files a command touches.
- The client draws state that is one round trip plus one send interval old. Interpolating between the last two renderable sets (#18) hides the send rate; input latency is accepted for now.
- The server's capacity, level and tick rate must match the client's replica: `welcome` carries the first two (`findLevel` resolves the name: levels are content both sides ship, see `content/levels/index.ts`), `FIXED_DT` is shared code.
- Bandwidth scales with what moves, not with the world: deltas are component-granular, so a feature that writes a component every tick (a timer, say) pays for it every send. Keep per-tick writes to components that really change.
- The sim gained a second kind of `SimHandle`. Code inside `packages/sim` that needs physics or the rng keeps taking a `Sim`; code that only reads entities takes `asEntityWorld(handle)` and works on both.
- Lockstep is not coming back: there is no need to keep `Math.*` out of features for cross-engine bit-identity. Determinism within one process (same seed, same commands, same state) still holds and is still tested, for replays and tests. This amends the motivation ADR 0002 gives for the deterministic Rapier build ("lockstep networking"): the build stays, for replays and for comparing a server against its tests.
