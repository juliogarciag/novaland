# Verifications for #22 - Free seats held by idle players

Ticket: https://github.com/juliogarciag/novaland/issues/22. Stacked on #17 (PR #27), the world room this adds to.

The change is server-only: the room measures every session's idle time on its own clock (`WorldRoomOptions.clock`, `performance.now` in production) from the last input that passed the edge gate, and `IDLE_TIMEOUT_MS` (10 minutes, `IDLE_TIMEOUT_SECONDS` in the environment for one boot) after it frees the seat, sends `player/leave` to the sim and closes the session with WebSocket close code **4100** and reason **`idle`** (`IDLE_KICK` in `packages/server/src/world/kicks.ts`). There is no browser client on this branch (#18 is adding it in parallel), so the highest-level user of this ticket is a Node client that does what the browser will: join by id, keep a replica, and see `onLeave(4100, 'idle')`.

Run everything (from anywhere; nothing to install beyond the workspace):

```bash
bash verifications/22-idle-seats/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the new room test (`worldRoom.test.ts`: "frees the seat of a session with no accepted input for 10 minutes, closing it with 4100 "idle", and keeps one that plays") passes on a **fake clock** in well under ten seconds: two real SDK clients join, the clock skips to a minute before the timeout and nobody is kicked, one sends a move and the other a malformed move that the gate drops (not input), the clock skips past the timeout and only the silent one gets `onLeave(4100, 'idle')`, its avatar vanishes from the other's replica, the next joiner gets its seat, and the mover is kicked later, measured from its move and not from its join; driven directly with a peer that never answers the close handshake, the seat is free and the next join gets it before any socket closes; a non-positive timeout is refused; every #17 room test still passes | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-idle-kick.mjs` (boots `IDLE_TIMEOUT_SECONDS=3 PORT=0 pnpm --filter @novaland/server dev` as a separate process, then runs `idleClients.ts` with the server package's `tsx`) | Against the real server process on the real clock: `IDLE_TIMEOUT_SECONDS=soon` stops the boot; the boot line reports the 3 s timeout; an idle client is closed with 4100 `idle` 3 s after joining (within a second) while a client that changes direction every second is still seated then and twice the timeout after its own join; `player/leave` reached the sim (the survivor no longer sees the slot); the kicked client rejoins into the same seat; once the mover stops it is kicked 3 s after its last move; every delta chained; the server logs one `world-room-idle-kick` line per kick, counts them in its `SIGTERM` stop line, and stops cleanly | `proof/02-idle-kick.json`, `proof/02-idle-kick-transcript.txt` |

The console output of each run is also kept as `proof/<script>.txt`.
