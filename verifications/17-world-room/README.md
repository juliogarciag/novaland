# Verifications for #17 - The world room: an authoritative Colyseus server with 5 seats

Ticket: https://github.com/juliogarciag/novaland/issues/17. Decision: [ADR 0004](../../docs/decisions/0004-multiplayer-netcode.md). Stacked on #16 (PR #24), whose exports and wire messages the room is built against.

There is no browser client yet (#18), so the highest-level user of this ticket is a Node client that does what the browser will: join the room by id, build a replica from the welcome, apply every delta and read it with the sim's view queries. The proof is therefore transcripts, not screenshots.

Run everything (from anywhere; nothing to install beyond the workspace):

```bash
bash verifications/17-world-room/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the room's tests exist and pass (`packages/server/src/world/worldRoom.test.ts`: a real server on a free port and real `@colyseus/sdk` clients: five joins by id each welcomed into the world wearing five distinct avatars on five distinct tiles, every player seeing the others move through deltas that chain, the sixth refused along with `create`/`join`/`joinOrCreate`, a leaver's seat freed and avatar gone and the next joiner seated there, oversized / unknown / slot-carrying / malformed messages dropped while the world runs, a flood spending the budget, a refused frame closing only its sender, `world/resync` answered with one full state), plus the unit tests of the inbound gate, the seats and the tick helper; `pnpm sim:headless` still runs | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-room-clients.mjs` (boots `pnpm --filter @novaland/server dev` as a separate process on a free port, then runs `clients.ts` with the server package's `tsx`) | Against the real server process: five Node clients join by id and get seats 0-4, the last welcome already holds everybody wearing five distinct sim-picked avatars on five distinct spawn tiles, each client sees all five avatars move and the five replicas draw the same thing, the sixth `joinById` is refused with code 522 "room is locked" and the other matchmaking methods are not exposed, a leaver frees seat 2 and vanishes for the others and the next joiner gets seat 2, twelve kinds of junk are dropped without moving the sender or the slot a payload names, a move flood is absorbed with the world ticking and nobody disconnected, a 4 KB frame closes only its own connection (1009), a resync yields one full state, every delta chained, and `SIGTERM` stops the server cleanly | `proof/02-room-clients.json`, `proof/02-room-clients-transcript.txt` |

The console output of each run is also kept as `proof/<script>.txt`. The `RangeError: Max payload size exceeded` stack trace in the server output of `proof/02-room-clients-transcript.txt` is expected: it is the transport refusing the 4 KB frame the clients send on purpose.
