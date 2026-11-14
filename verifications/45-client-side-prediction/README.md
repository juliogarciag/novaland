# Verifications for #45 - Client-side prediction for the local player

Ticket: https://github.com/juliogarciag/novaland/issues/45. Decision: [ADR 0011](../../docs/decisions/0011-client-side-prediction.md).

The highest-level user of this ticket is a person playing online from far away: they press a key and their character has to move on the next frame, whatever the round trip, while the server stays the authority. So the proof is a measurement in Chromium against the real room server and the real client, with a proxy between them that adds the latency (`latency-proxy.mjs`: every WebSocket message waits half the round trip in each direction; it can also lose one of the client's messages on request).

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/45-client-side-prediction/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install`, `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and the headless tests this ticket adds exist and pass: the sim's prediction (adopts a player from a replica, walks it exactly as the server does, walls included, refuses what it cannot give a body to, leaves the server's sim untouched), the room's acknowledgement and protocol check, the edge gate with its fuzz, the client connection, and prediction over a simulated link at 100 ms and 300 ms (14 tests, among them a move the server never applies, a move the server alters, a teleport, jitter, a new seat, a hidden tab, a prediction that fails, fuzzed acknowledgements). `pnpm build` still leaves Rapier in a chunk of its own that the page's bundle does not inline | `proof/01-check.txt`, `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-latency.mjs` | The ticket's "Done when", at 100 ms and 300 ms of round trip, in Chromium. **Key press to motion**: with prediction the local player is drawn somewhere else within two frames of every key press; with `VITE_PREDICTION=off` the same presses wait for the round trip and the buffer. **Convergence**: after every release the drawn position ends exactly on the server's, with nothing left to acknowledge or correct. **Forced disagreement**: a move the proxy loses is drawn at once, about one round trip of walking ahead and no further, and is taken back, over several frames and never in one jump, both when the next move is acknowledged and when the key stays down and the client gives the move up after a second. **Two players** see each other walk and agree on where everyone is; each draws the other behind its replica (server states) and itself ahead of it. **HUD latency** shows the injected round trip with prediction on and off | `proof/02-latency.txt`, `proof/02-latency.json`, `proof/02-latency-*.png` |
| 03 | `03-fuzz.mjs` | The new network-facing input, fuzzed over the wire against the real room server (seed in the report): 150 joins with random options are refused unless the protocol is exactly this one and none keeps a seat; 500 random `player/move` payloads from a seated client are acknowledged only when they were well-formed moves; a flood is closed; raw garbage frames from joined sockets do not take the room down. A well-behaved witness plays throughout: its deltas chain without a gap and every acknowledgement names a move it sent, in order, with a tick the next update has reached | `proof/03-fuzz.txt`, `proof/03-fuzz.json` |
| 04 | `04-production.mjs` | The built server and client (`pnpm build`, `pnpm start`): the page is seated, fetches the physics chunk by itself after its own bundle, the security policy still lets the WASM run, nothing warns that prediction could not start or stopped, and a key press changes what is drawn. A production page has no debug hooks, so the timing itself is measured in 02 | `proof/04-production.txt`, `proof/04-production.json`, `proof/04-production-*.png` |

What is not measured end to end: the server altering a move (as opposed to never receiving it). Nothing in the game does that today, so it is covered where a test can make it happen, in `OnlineWorld.prediction.test.ts` ("follows the server when it moves the player somewhere the client did not predict").

## Trying it by hand with latency

```bash
PORT=5146 pnpm --filter @novaland/server dev
```

```bash
LISTEN_PORT=5147 TARGET_PORT=5146 ROUND_TRIP_MS=100 node verifications/45-client-side-prediction/latency-proxy.mjs
```

```bash
VITE_SERVER_URL=ws://localhost:5147 PORT=5145 pnpm dev
```

Add `VITE_PREDICTION=off` to the last line to feel the same latency without prediction.
