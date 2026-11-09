# 0005 - The world room: one fixed room id, join by id only, and how "full" reaches the client

Status: accepted. Date: 2026-11-09. Supersedes the "join" row of the wire table in ADR 0004; everything else in 0004 stands.

## Context

ADR 0004 fixed the wire messages between the browser and the world server and wrote, for the join, that "a full room refuses the join with reason `JOIN_REFUSAL.worldFull` (`'world-full'`)". Building the room (ticket #17) on Colyseus 0.18 showed three things that row did not settle and one it got wrong:

- A client needs the room's id to join it, and there is only ever one world.
- Colyseus's matchmaker exposes `create`, `join`, `joinOrCreate`, `joinById` and `reconnect` to any client by default. `create` and `joinOrCreate` would let a stranger spawn a second world when the first is full.
- Colyseus locks a room by itself when `maxClients` is reached (counting reserved seats), and its matchmaker refuses a `joinById` to a locked room **before any room code runs**, with its own error. The room cannot put `'world-full'` into that refusal. The only way to make the sim's string reach the client would be to stop the room from locking and refuse in `onJoin` instead, which lets any number of seat reservations pile up for 15 seconds each on a public endpoint. Not worth the string.

## Decision

- **The room id is `world`.** `WorldRoom.onCreate` overrides `roomId` (Colyseus allows that during creation). The boot creates the room once, right after the server listens; clients call `joinById('world')` and never look rooms up.
- **The matchmaker exposes `joinById` only** (`matchMaker.controller.exposedMethods = ['joinById']`). `create`, `join`, `joinOrCreate` and `reconnect` answer `MatchMakeError` code 520 (`MATCHMAKE_NO_HANDLER`, "invalid method"). Reconnection is therefore off: a dropped connection frees the seat and the player joins again as a new session. A later ticket that wants seat recovery adds `reconnect` back here deliberately.
- **A full world refuses the join the way Colyseus refuses a locked room**: `MatchMakeError` with code 522 (`ErrorCode.MATCHMAKE_INVALID_ROOM_ID`) and the message `room "world" is locked`. The room never locks explicitly, so a client that gets code 522 with a message containing `locked` shows "world is full". The same code with `not found` means the server is up but the room does not exist yet (the boot is still running) or is disposing: show "world is not ready". `JOIN_REFUSAL.worldFull` stays in the sim as the reason the room would give if a sixth session ever reached `onJoin` (a guard behind the matchmaker, with the same code 522 and the message `world-full`, which the client maps to "world is full" as well); it is not what clients see today.
- `maxClients = 5` and `autoDispose = false`: the matchmaker enforces the seats, and the empty world stays up. A seat reservation (the HTTP half of a join) counts against the five and expires after `SEAT_RESERVATION_SECONDS` (3), so bare HTTP requests cannot hold the world locked for long.
- **A client registers its `world/delta` and `world/state` handlers before it awaits the welcome.** Colyseus buffers everything sent to a session until the join is acknowledged, then flushes it in one batch, so the first delta can arrive in the same batch as the welcome; the SDK drops a message that has no handler. The client buffers updates until its replica exists, then applies them. A session that never acknowledges its join is closed after `JOIN_ACK_TIMEOUT_MS`, because nothing can be sent to it meanwhile.

## Consequences

- The client (#18) joins with one call and maps two refusals by code and message; it never creates rooms.
- Idle-seat kicking (#22) and hosting (#19, #20) build on one room with a known id; health checks can use Colyseus's `GET /__healthcheck`.
- If Colyseus ever lets a room name its own lock reason, the client's mapping is the one place to change.
