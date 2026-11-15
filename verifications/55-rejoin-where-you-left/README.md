# #55 Players rejoin where they left

What is verified: a player who quits and joins again stands where they left, from the browser, against the real room server with its positions on disk (`DATA_DIRECTORY`, a scratch directory) and the real client.

```bash
bash verifications/55-rejoin-where-you-left/run.sh
```

One browser context is one browser profile: its tabs share `localStorage`, so they share the player token. Expected numbers (the spawn tile, tile sizes) are read from `window.__novaland`, not typed in.

| Script | What it proves | Proof |
|---|---|---|
| `01-rejoin.mjs` | A browser with no token spawns next to the spawn tile and gets a 43-character token | `proof/01-rejoin.txt`, `proof/01-rejoin.json` |
| | The player walks 13 tiles away, closes the tab, opens it again and stands on the same point | `proof/01-walked-somewhere.png`, `proof/02-reopened-tab-same-place.png` |
| | A second browser profile has another token and spawns as a new player | `proof/03-second-profile-is-a-new-player.png` |
| | The server process is killed (`SIGKILL`) and started again on the same directory: the page reconnects by itself and the player stands where they were | `proof/04-server-gone.png`, `proof/05-after-crash-same-place.png` |
| | The server is stopped as a deploy stops it (`SIGTERM`) right after the player moved, with no time for a periodic save: same result | `proof/06-after-restart-same-place.png` |
| | A second tab of the same profile takes the player over: one player, one seat, the first tab shows the `elsewhere` screen and does not come back by itself; "Play here" takes the player back | `proof/07-first-tab-elsewhere.png`, `proof/08-first-tab-plays-again.png` |
| | The server never prints a token, and the token is not in the world state nor on the debug API | `proof/01-rejoin.txt` |

Forged and malformed joins are covered headlessly, where thousands of them are cheap (`pnpm test`):

- `packages/server/src/world/returningPlayers.test.ts`: 600 fuzzed join options against the room (positions under every field name the code uses, slots, ready-made keys, whole commands, broken tokens): none throws anything but the protocol refusal, every player appears next to the spawn, and a known player's place opens only to their token. Also: two joins of one token in one tick, a seat's previous holder, the 10-second rule, the save on dispose, and that no message or log line carries the token or its key.
- `packages/server/src/world/inbound.test.ts`: 20,000 fuzzed options through `readPlayerKey`.
- `packages/server/src/world/savedPositions.test.ts`: the store's limit under a flood of 5,000 new players, a file that is not a store, a failing disk.
- `packages/sim/src/features/player/returnTo.test.ts`: 2,000 fuzzed `returnTo` points through the sim's handler; the nearest-free-tile rule; determinism.
