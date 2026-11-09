# @novaland/server

The authoritative world server (ticket #17, ADR 0004): one Colyseus room that owns the only live sim, steps it, and tells every player what the world looks like.

```bash
PORT=5117 pnpm --filter @novaland/server dev   # default port 2567 when PORT is unset; a busy PORT fails the boot
pnpm sim:headless                               # the sim alone, five simulated seconds, prints a state hash
```

The boot prints one JSON line with the port, the room id, the seed of this boot (random, so a session can be replayed) and the rates. Colyseus answers `GET /__healthcheck` with `OK`.

## The room

- One `WorldRoom` is created at boot (`startWorldServer`) with room id `world`; clients join it with `joinById('world')`. The matchmaker only exposes `joinById`: `create`, `join` and `joinOrCreate` are refused, so a client can neither spawn a second world nor join one by name.
- `maxClients = 5`. A sixth `joinById` is refused by the matchmaker with a `MatchMakeError` whose code is 522 (`ErrorCode.MATCHMAKE_INVALID_ROOM_ID`) and whose message says the room is locked; the room never locks for any other reason, so a client shows that as "world is full". `JOIN_REFUSAL.worldFull` guards the seat allocation behind it.
- The room steps the sim with the same whole-tick arithmetic as the client (`takeWholeTicks`): real time earns ticks of `FIXED_DT`, catch-up is capped at `MAX_CATCH_UP_SECONDS`, and nothing else calls `step`.
- Seats are slots 0-4, lowest free first. A join queues `player/join`; the welcome (`world/welcome`) carries the full state taken after the tick that processed it, so the client finds its own entity in it. A leave, consented or dropped, frees the seat and queues `player/leave`.
- Inbound messages pass the edge gate in `src/world/inbound.ts`: only `player/move` and `world/resync` are handled (everything else is dropped and counted), each session has a token budget (`INBOUND_BURST`, then `INBOUND_MESSAGES_PER_SECOND`; over it, dropped), a decoded payload longer than `MAX_INBOUND_BYTES` is dropped, and a move must be exactly `{ x, y }` with finite numbers, so a payload that carries a `slot` is dropped. The command that reaches the sim carries the session's slot, never anything from the payload. Frames over `MAX_FRAME_BYTES` are refused by the transport, which closes that connection (code 1009); a flood past `DISCONNECT_MESSAGES_PER_SECOND` is disconnected by Colyseus.
- Outbound: every `TICKS_PER_SEND` ticks each welcomed session gets a `world/delta` diffed from the last state sent to it (sessions at the same tick share one diff), or a `world/state` if it asked for one with `world/resync` (many requests collapse into one state).

Tuning lives in `src/world/tuning.ts`; game rules do not live here at all.

## Tests

`pnpm --filter @novaland/server test` runs the unit tests of the gate, the seats and the tick helper, plus `worldRoom.test.ts`: a real server on a free port and real `@colyseus/sdk` clients that build replicas from what they receive, covering five joins, movement seen by everyone, the refused sixth, a leaver's freed seat and vanished avatar, junk dropped while the world runs, a flood, a refused frame and a resync.
