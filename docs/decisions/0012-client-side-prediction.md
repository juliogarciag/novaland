# 0012 - Client-side prediction: a second, local sim that only ever guesses

Status: accepted. Date: 2026-11-14. Supersedes (ticket #45):

- the "No client-side prediction" clauses of [0004](0004-multiplayer-netcode.md) and [0006](0006-client-online-mode.md);
- three rows of 0004's wire table: the join now carries `{ protocol }` and has a second refusal, `protocol-mismatch`; `world/welcome` also carries `protocol`; `player/move` also carries `sequence`. The table gains a row, `player/move-applied`. [0005](0005-world-room-join.md)'s `joinById('world')` is now called with those options;
- the claim of [0007](0007-physics-loads-on-demand.md) that an online page never fetches Rapier.

Everything else in those records stands.

## Context

Online, the local character moved only when the server's state came back and passed the interpolation buffer: one round trip, up to one send interval, plus 100 ms of buffer. From Lima to US East that is 200-250 ms between a key press and movement, and the host has no closer region. The fix is the standard one: the client applies its own input at once to a predicted state, the server stays the authority, and every server state is reconciled by replaying the input the server has not applied yet.

Three things had to be decided: what runs the movement rules on the client without breaking rule 4 (a replica's `step` throws), how much of #2 (restore a sim from a snapshot) that needs, and how the client learns which of its commands a server state already includes.

## Decision

### A prediction is a third kind of sim, and it is never the truth

- `createPrediction({ level, capacity })` (`core/create.ts`; the rest is in `core/prediction.ts`; both exported from the sim) returns a `PredictionHandle`: a real `Sim` with every feature, its own physics world and the level's terrain, and nothing else. It holds no players until one is adopted.
- `adoptEntity(prediction, source, eid)` makes entity `eid` of the prediction what it is in `source` (the replica): same id, same components except `Body`, whose handle belongs to the server's physics world. Each feature then gives the entity the body it would have had at spawn, through a new optional `Feature.attachBody(sim, eid)` hook; the player feature attaches the same ball it attaches on `player/join`. An entity that ends up with no body, that points at no def, or whose id the prediction already uses for something of its own is not adopted, and `adoptEntity` answers `false`. `releaseAdoptedEntities(prediction)` removes what was adopted.
- The replica stays exactly what it was: only `applyWorldState` writes it and its `step` still throws. The client now holds two handles: the replica is what the server said, the prediction is a guess about the local player that is thrown away and rebuilt from the replica at every server state. Nothing reads game state from the prediction except the drawn position and heading of the local player.
- Rule 4 gains a clause: online, `OnlineWorld` steps the prediction, through its `LocalPlayerPrediction` (`client/src/online/prediction.ts`, the only file in the client that calls `step` on one), and nothing else does. Its ticks come from real time like every other tick. The server remains the only thing that steps the world.
- The ids a prediction adopted are kept in a set on the `Prediction`, outside components. Rule 3 (state lives in components, physics and the rng) is about sims that are saved or replicated; a prediction is never snapshotted or restored, only rebuilt.

### Only the local player is predicted, so #2 is not needed

A player's movement depends on its own intent and on terrain: players pass through each other. Terrain comes from the level, which both sides ship, so a sim with the level and the local player computes the same movement as the server. That needs one entity copied from a world state with its body rebuilt by its feature, not a whole sim restored with its physics bytes and rng. #2 stays open for save files and replays; `adoptEntity` is the part of it prediction needs, built on the same `core/restore.ts`.

The limit this draws: whatever can push or stop the local player must be in the prediction. Today that is terrain. A feature that adds such a thing (a door, a moving platform) either lets the misprediction be corrected by reconciliation, or has the client adopt those entities too; `adoptEntity` takes any entity whose feature implements `attachBody`.

Features' `update` hooks run in the prediction as they do in a sim. A feature that spawns things on its own would spawn them there too, unseen. None does today; one that does should skip a sim that is a prediction (`sim instanceof Prediction` inside the package).

### The wire carries a sequence up and an acknowledgement down

- `player/move` is now `{ x, y, sequence }`: a positive safe integer the client counts up. The server's edge gate checks it like the rest of the payload.
- New message, server to client: `player/move-applied`, payload `{ sequence, tick }`. It says the sim applied this client's move `sequence` in the step that made its tick `tick`. The room sends it to the session just before the next world update, and only when it changed, so on an ordered socket the update that follows is the first state that includes that move, and every move up to `sequence`.
- The acknowledgement is a message of its own and not a field of the world state: deltas are diffed once per `fromTick` and shared between sessions, and a world state is the sim's entities, not one session's bookkeeping.
- The sequence is not part of `MoveCommand`. The sim's command stays `{ type, slot, x, y }`; the sequence is the room's.
- `WIRE_PROTOCOL` (now 2) names the contract. The client sends it as the join option `protocol` and the server refuses any other value with `JOIN_REFUSAL.protocolMismatch`; the welcome carries the server's `protocol` and the client refuses any other value. Both ends report it as `incompatible` and offer the reload. A bundle from before this change sends no option and is refused instead of being seated on a server that would drop its every move; it shows its disconnected screen until the tab is reloaded.

### Colyseus's own input and prediction API was considered, and does not fit this world

Colyseus 0.18 ships the same idea as a framework feature: `Room.defineInput()` and `room.input()` for a per-tick input stream, an acknowledgement of the last input consumed, and `Predict` / `SimReconciler` in the SDK for rollback, replay and smoothed corrections. The project prefers a framework hook to hand-written infrastructure, so it was read before this was built (`@colyseus/core` 0.18.27, `@colyseus/sdk` 0.18.9). It was not used, for reasons that are about this world's earlier decisions and not about the feature:

- The acknowledgement travels only as a prefix on Colyseus's Schema state patches. A room with no Schema state sends no patch and so no acknowledgement (`broadcastPatch` returns early without `state`; the none-serializer ignores the timing). This world replicates through its own `world/delta` messages and holds no Schema state (ADR 0004). Using the hook means either moving replication to Schema, which 0004 decided against, or keeping a stub state on a second send path and trusting two timers to stay in step so an acknowledgement and the delta it describes arrive together.
- Its reconciler replays one step per input, so a predicting client sends one input per tick, sixty messages a second per player, consumed one per server tick from a buffer. Ours is one `player/move` when the direction changes. The room's edge gate, its message budget (20 a second), the room's disconnect ceiling (Colyseus's `maxMessagesPerSecond`, set to 60 here, which input frames count against) and the idle-seat rule ("a held key sends nothing more", #22) are all built on that and would be rebuilt.
- The SDK's reconciler takes the SDK's `Room` and `InputHandle`. The transport is confined to `online/connection.ts` behind a small interface that tests fake (ADR 0006; five methods since #35 added `ping`); the prediction would have to reach past it. Its replay also assumes one step per pending input, which does not hold for sparse moves, so the client half cannot be used without the server half.

What this record keeps from it is the shape: adopt the server's scalars, replay, smooth the error on the drawn pose, and accept that engine-internal state (contact caches) is not rolled back, the same trade-off its documentation states. If the world later moves to per-tick input (a second input kind, or lag compensation), that is the moment to adopt the framework's stack whole, and it should replace this one, not sit beside it.

### Reconciliation (`client/src/online/prediction.ts`)

- The prediction has its own clock: a client tick counted from real time (`performance.now()`, not the game loop's smoothed delta, which loses time in a hitch). Each move is recorded with its sequence and the client tick it is applied in, sent, and applied to the prediction in that tick: the last one real time has earned when the key is read, so a move made during a hitch is not dated before the hitch.
- An acknowledgement gives the one number that ties the two timelines together: `serverTick - clientTick` for that move. It is re-measured at every acknowledged move.
- After every applied update the local player is adopted again from the replica, moves the server acknowledged are forgotten, and the remaining ones are replayed: the prediction steps from the client tick the server state corresponds to up to now, each move in its recorded tick. When the server agreed this lands on the position the prediction already had.
- What is drawn is the predicted position, interpolated inside the current tick, plus a correction: the difference a reconciliation made, which halves every `CORRECTION_HALF_LIFE_SECONDS` until it is gone instead of being shown as a jump. A difference larger than `SNAP_DISTANCE_METRES` is a teleport and is shown at once; that distance is longer than a player walks in the second a guess may last.
- The client never predicts further than `MAX_PREDICTION_TICKS` (one second) ahead of the last server state, replaying or stepping live: when states stop coming the guess stops growing. A move not acknowledged for that long is given up: it is no longer replayed, but it is remembered, so its acknowledgement still ties the timelines together when it comes late (a round trip over a second). That is what guarantees the client cannot stay off the server's state: with no unacknowledged move the replay only repeats the intent the server holds, and with a zero intent it is the server's position exactly.
- Other players are untouched: they are drawn from the frame buffer, two send intervals behind. `OnlineWorld.nextFrame` takes the buffer's frame and replaces the local player's renderable and heading with the predicted ones.
- When the prediction starts while the player is already walking (Rapier finished loading with a key down), the held move is sent again so its acknowledgement anchors the timeline, and the step from where the player was being drawn to where it is predicted fades like a correction.
- Prediction is an improvement, never a requirement. Until Rapier has loaded, when the entity cannot be adopted, or if the prediction ever throws or yields a position that is not finite, the local player is drawn from the buffer as before. `VITE_PREDICTION=off` switches it off for comparison.

### Physics loads after the seat

`createPrediction` loads Rapier (ADR 0007). `OnlineWorld` starts that load once seated and plays unpredicted until it resolves, so the join is not slower. The main bundle still holds no physics; an online page now fetches the `rapier-*` chunk in the background.

## Consequences

- The local player moves on the frame after a key press at any latency. The HUD's latency figure is the connection's ping and does not change.
- Start and stop are each re-anchored by their own acknowledgement. Network jitter between the two shows up as a correction of a tick or two of movement (centimetres), smoothed.
- If the server drops time (a stall longer than `MAX_CATCH_UP_SECONDS`) while a player holds one direction, the prediction runs ahead by that much until the next move is acknowledged or the player stops. If the server drops more than a second, the prediction sits at its one-second limit and the player advances with each server state instead of each frame until then. Accepted: the room is built to stall never, and restarts if it does.
- An online page downloads Rapier (about 1.3 MB gzipped) after it is seated. The claim in 0007 holds for the main bundle only.
- A new player-facing command that should feel immediate must be recorded and replayed like `player/move`; one that is not is simply unpredicted and arrives with the server state.
- `Feature` has a new optional hook. A feature whose entities need a body in a prediction implements `attachBody`; others are unaffected.
- Old bundles are refused at the join after a deploy that changes `WIRE_PROTOCOL`. Bump it with every change to the messages.
