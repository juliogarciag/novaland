# Verifications for #18 - Client online mode: join the shared world

Ticket: https://github.com/juliogarciag/novaland/issues/18. Decisions: [ADR 0004](../../docs/decisions/0004-multiplayer-netcode.md) (netcode model) and [ADR 0005](../../docs/decisions/0005-world-room-join.md) (the join contract) and [ADR 0006](../../docs/decisions/0006-client-online-mode.md) (how the client hosts both modes). Stacked on #17 (`17-world-room`), whose room server these scripts boot, and on #16 (PR #24).

The highest-level user of this ticket is a person who opens the URL in a browser while a world server runs, gets a seat and sees the other players; and a person (or an agent's verification) who runs plain `pnpm dev` and gets the solo game exactly as before. So the proof is Playwright against the real room server and the real dev server, plus the solo page.

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/18-client-online-mode/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless tests this ticket adds exist and pass: the connection state machine (connecting, welcome to online, world full with retry, dropped to disconnected and back, unreachable server retried with backoff, welcome timeout, incompatible welcome), the online world (replica fed from welcome and deltas, `out-of-sequence` answered with `world/resync`, the local seat, `n/5 online`, the last move re-sent after a reconnect), the frame buffer and interpolation (draws ~2 send intervals behind, 60 Hz positions between 20 Hz frames, snaps appearing and vanishing entities, catches up after a stall), plus the untouched sim, replica, server and client tests | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-solo.mjs` | Plain `pnpm dev` (no `VITE_SERVER_URL`) boots the local sim as before: no screen, no online status, `window.__novaland.sim` is a live sim that ticks, the player walks on a key press and the HUD has no online counter; then the existing browser verification of ticket #10 (`verifications/10-player-sprite/03-browser.mjs`) still passes against this branch (its proof folder is set aside and put back, so #10's files are not changed) | `proof/02-solo.json`, `proof/02-solo-*.png`, `proof/02-solo-10-player-sprite.txt` |
| 03 | `03-online.mjs` | Against the real room server (`PORT=<n> pnpm --filter @novaland/server dev`) and the real client (`VITE_SERVER_URL=ws://localhost:<n> pnpm dev`), in Chromium: a page whose join is held shows the connecting screen, a page opened before the server is up shows the disconnected-and-retrying screen and joins by itself once the server boots; two browser contexts get seats, each sees the other's avatar, and when one holds a key the other sees it move (the replica position and the drawn sprite); the drawn position changes far more often than the replica does (interpolation: ~60 Hz motion from 20 Hz updates) and lags the replica by about two send intervals; each page's camera is centred on the avatar of the seat the server gave it (checked away from the spawn stack, where it is live on both axes), also after a reconnect to another seat; the HUD reads `2/5 online`; five contexts fill the world and a sixth sees the world-full screen whose Retry button sends a new join at once; closing a context removes its avatar for the others within a second and lets the sixth in on its next retry; killing the server shows the disconnected-and-retrying screen on every page and the retries keep coming while it is down, restarting it brings every page back online with a seat and moving again; the replica is `window.__novaland.sim` and never steps; no uncaught page errors | `proof/03-online-*.png`, `proof/03-online.json` |
| 04 | `04-dev-online.mjs` | `pnpm dev:online` (root script) starts the server and the client together on the ports given, the page joins the world, and stopping the script stops both | `proof/04-dev-online.json` |

The console output of each run is also kept as `proof/<script>.txt`.
