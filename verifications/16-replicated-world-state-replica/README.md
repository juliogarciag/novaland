# Verifications for #16 - Replicated world state and a read-only sim replica

Ticket: https://github.com/juliogarciag/novaland/issues/16. Decision: [ADR 0004](../../docs/decisions/0004-multiplayer-netcode.md).

This ticket has no browser-visible change: it is the contract the server room (#17) and the client online mode (#18) are built against. The proof is therefore headless, from the perspective of those two consumers: a server that sends, a client that receives and draws.

Run everything (from anywhere; nothing to install beyond the workspace):

```bash
bash verifications/16-replicated-world-state-replica/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass, and the headless tests the ticket asks for exist and pass: a replica fed full states every tick, a replica fed deltas at a send rate through joins, leaves and a recycled entity id, removed entities disappearing, out-of-sequence deltas, a restarted server, `step` throwing, malformed network data, a `DefRef` at no def, pure diff → apply through JSON, the entity-id allocator against a model, and the untouched determinism and snapshot tests | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-replica-session.mjs` (runs `session.ts` with the server package's `tsx`, against `@novaland/sim`'s public entry only) | A 20-second session with the room's five players over a simulated wire: a `welcome` with a full state, then `world/delta` messages at `DEFAULT_SEND_RATE` as JSON strings; at every send `getRenderables`, `worldState`, `findPlayerEntity` and `getHeading` on the replica equal the sim's; a delta is a few hundred bytes while the full state is far bigger; a dropped delta is reported `out-of-sequence` and a full state resyncs; hostile messages never throw and the replica recovers; `replica.step()` throws | `proof/02-replica-session.json` |

The console output of each run is also kept as `proof/<script>.txt`.
