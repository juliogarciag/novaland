# Verification template

The starting point for a ticket's `verifications/<ticket>/` folder, and the only folder under `verifications/` that is kept working. Every other folder is the proof of one ticket, frozen when its PR merged: do not run, repair, read or copy from them.

## Start a ticket's folder

From the repo root, in the ticket's worktree:

```bash
cp -R verifications/_template verifications/<ticketNumber>-<ticketKebabTitle>
```

Then, in the copy:

1. Keep `solo.mjs` (the client alone, `pnpm dev`), `online.mjs` (the room server and a client joined to it), or both; delete the one the ticket does not need and rename what stays after what it proves (`01-check.mjs`, `02-browser.mjs`, ...). List them in `run.sh`.
2. Change the ports at the top of each script to ones no other session uses. They must differ from the dev server you leave running for the human, because a pinned port refuses to start twice.
3. Replace the example checks with what the ticket promises, from the point of view of its highest-level user. Derive expected numbers from `window.__novaland` (level, grid, defs, camera), never from constants typed into the script.
4. Replace this README with the ticket's own: what is verified, how to run it, and a table of script, what it proves, and proof file.

Run it from anywhere; the first run installs Playwright in the folder:

```bash
bash verifications/<ticketNumber>-<ticketKebabTitle>/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure and writes into `proof/`: the JSON report, the screenshots, and the console output as `proof/<script>.txt`. Commit `proof/` with the ticket.

Search skips every ticket folder, yours included (the root `.ignore`). To search yours, name it: `rg <pattern> verifications/<ticket>/`.

## What is here

| File | What it gives you |
|---|---|
| `solo.mjs` | Starts `PORT=<n> pnpm dev`, opens Chromium, reads the sim through `window.__novaland`, presses a key, writes a screenshot and a report |
| `online.mjs` | Starts the room server and a client with `VITE_SERVER_URL`, seats two tabs, reads each replica and connection, writes screenshots and a report |
| `lib.mjs` | `start` (a server that stops with the script), `waitForPort`, `waitFor`, `check`, `summarize`, `writeProof`, and the `ROOT` and `PROOF` paths |
| `run.sh` | Installs on first run, runs the scripts in order, keeps their console output as proof |

## What the template relies on

A ticket that changes any of these updates the template in the same PR, and runs it once to show it still passes (`bash verifications/_template/run.sh`; its `proof/` is gitignored):

- `PORT=<n> pnpm dev` pins the client's port and prints `localhost:<n>/` when ready.
- `PORT=<n> pnpm dev` in `packages/server` starts the room server and prints a `world-room-listening` line; `VITE_SERVER_URL=ws://localhost:<n>` makes the client join it.
- `window.__novaland`: `sim.tick`, `snapshot()` (entities with `Player.slot` and `MoveIntent`), `localSlot()`, and online `online.status()` with `kind` and `slot`.
- The connection screens are `#screen[data-screen]`, hidden while playing.
- WASD moves the local player.
