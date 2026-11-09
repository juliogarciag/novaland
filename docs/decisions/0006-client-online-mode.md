# 0006 - Client online mode: one playable world, two ways to fill it

Status: accepted. Date: 2026-11-09. Builds on [0004](0004-multiplayer-netcode.md), which fixes the netcode model (authoritative server, replica clients, interpolation in view space), and [0005](0005-world-room-join.md), which fixes the join: one room id, `joinById` only, and how a full world and a booting server reach the client. This record covers the choices those two left to the client (ticket #18).

## Context

The browser has to play two worlds with one code base: its own sim when `pnpm dev` runs with no server, because every verification and most agents' work runs that way, and the shared world on a server when `VITE_SERVER_URL` is set. The scenes, the renderer, the camera and the HUD already read a `SimHandle`; the questions were where the two modes meet, how the transport stays out of the rest of the client, what the player sees while not seated, and how the drawn frame relates to the server's updates.

## Decision

### One `PlayableWorld`, two implementations

- `packages/client/src/worlds/PlayableWorld.ts` is what the scenes play: a `sim` to read, a `localSlot` to follow with the camera, an `occupancy` for the HUD and one method, `nextFrame(commands, deltaSeconds): ViewFrame`, that takes the frame's commands and real time and returns what to draw.
- `LocalWorld` (`worlds/LocalWorld.ts`) is solo play: it owns the sim, turns real time into whole ticks with `takeWholeTicks` and steps it, as the scene itself did before. `OnlineWorld` (`online/OnlineWorld.ts`) holds the replica, sends `player/move` over the wire and draws from a buffer of server states. `main.ts` picks one from the environment; the Phaser side does not know which it got.
- A `ViewFrame` (`render/viewFrame.ts`) is the unit the renderer draws: the renderables and the headings of one tick. `EntityRenderer.draw(frame)` replaces reading the sim directly, so an interpolated frame and a live one go through the same code. `readViewFrame(handle)` reads one from a sim or a replica; `interpolateViewFrames(from, to, alpha)` is the view-space interpolation ADR 0004 asked for.

### The transport is confined to `client/src/online`

- `@colyseus/sdk` is confined to `packages/client/src/online/` by lint (`eslint.config.js` refuses `@colyseus/*` anywhere else in the client) and, by convention, to one file there: `online/connection.ts`, behind a four-method `JoinedRoom` interface (`onMessage`, `onLeave`, `send`, `leave`). Tests join a `FakeRoom`. When the transport changes (WebTransport, another SDK), one file changes.
- The SDK's automatic reconnection is switched off on every room. The server does not expose `reconnect` and keeps no session to reconnect to (ADR 0005), so a reconnection would only fail a few times before the client could try a fresh join. Every return is a new join and a new seat.
- `WorldConnection` owns the retry policy: a full world is asked again every `FULL_WORLD_RETRY_MS` (and at once on the screen's button, which reaches the connection from the first moment, before anyone is seated), an unreachable server or a dropped connection after `RECONNECT_DELAYS_MS` (1, 2, 4, 8 s, then 8 s), a room that sends no welcome within `WELCOME_TIMEOUT_MS` is dropped. The refusals are mapped as ADR 0005 fixes them: code 522 with "locked" (or the room guard's `JOIN_REFUSAL.worldFull`) is a full world; the same code with "not found" is a server still booting and is retried like an unreachable one.

### One replica for the life of the page

- The replica is created from the first welcome, because that is where the level and the capacity come from, and the scene is built on it. A later welcome, after a drop, is applied to the same replica: a full state replaces everything whatever its tick, the seat becomes the new `slot`, the frame buffer starts over and the move the player is still holding is sent again, because the new seat never heard of it.
- A later welcome for another level or capacity cannot be shown by a scene built for the first, so it is reported as `incompatible` like a first welcome the client cannot use (an unknown level name, a capacity `createReplica` refuses, a payload of the wrong shape): the connection stops and the screen says why and offers a "Reload page" button. Nothing is retried and the page never reloads itself: a server that could make it do so could loop a tab through re-downloads for as long as it liked.

### Screens are DOM, not scenes

- Connecting, world full, disconnected and incompatible are one `<div id="screen">` over the canvas (`online/screens.ts`), with `data-screen` naming the state for end-to-end checks, a "Retry now" button for full and disconnected and a "Reload page" button for incompatible. They have to exist before the game does (there is nothing to draw until a welcome brings the level) and must keep counting down when the connection, and with it the reason to render, is gone. Nothing in them is game state.

### The drawn frame runs two send intervals behind

- `online/frameBuffer.ts` keeps the last few `ViewFrame`s read from the replica after each applied update and a drawn tick that advances with real time but aims `INTERPOLATION_BUFFER_TICKS` (two send intervals at `DEFAULT_SEND_RATE`: 6 ticks, 100 ms) behind the newest frame, so there is almost always a frame on each side of it and 20 Hz updates draw as 60 Hz motion. Small drift is closed gradually (a tenth per frame); more than a buffer behind, it jumps; ahead of its target (frames late, a stall) it slows down and holds on the newest frame, never going back. A frame that does not come after the newest one (a full state after a server restart) starts the buffer over.
- Headings come from the newer of the two frames, so a walk cycle starts up to one send interval before the interpolated position starts moving. That is below what a player notices and keeps the buffer free of per-component knowledge.

### What is duplicated, on purpose, until the contract carries it

- `WORLD_ROOM_ID` (`'world'`) and `WORLD_SEATS` (5) are repeated in `client/src/online/tuning.ts` from the server's tuning. The sim's wire contract (`core/wire.ts`, ticket #16) does not carry them and this ticket does not change #16's or #17's files. The HUD counts entities in seats `0..WORLD_SEATS-1`; the server, not that number, decides who gets in. Moving both into `WIRE` or the welcome is a one-line follow-up once those branches merge.

## Consequences

- A feature that works solo works online if it reads the sim through `@novaland/sim` and sends its input as commands: replication is feature-agnostic (ADR 0004). A new player-facing command still needs its wire message and a line in `OnlineWorld.advance` that sends it, until a generic command envelope exists.
- AGENTS.md rule 4 gains an online clause: the server owns the tick, the client only reads; `step` on a replica throws.
- `window.__novaland` works in both modes with the same fields (`sim` is the replica online) plus `localSlot()` and, online, `online.status()`, `online.retryNow()` and `online.malformedUpdates()`.
- `pnpm dev:online` (`scripts/dev-online.mjs`) runs the server and the client together for local play; `SERVER_PORT` and `PORT` pin them.
- No client-side prediction: input latency is one round trip plus the buffer. Prediction would run the sim on the client from a restored state and is a later ticket, on top of this one.
