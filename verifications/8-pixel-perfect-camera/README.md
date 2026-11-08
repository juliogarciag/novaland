# Verifications for #8 - Pixel-perfect camera that follows the player

Ticket: https://github.com/juliogarciag/novaland/issues/8

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/8-pixel-perfect-camera/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the whole-number zoom and device-pixel snapping unit tests ran and passed; the bigger starter level still passes the sim's movement and determinism tests | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-camera.mjs` | In Chromium (Playwright), at 960x720 and 1600x900 and at DPR 1 and 2: the canvas backing store is the CSS size times `devicePixelRatio`, the zoom is the largest whole number showing at least 20 metres, the player is in the middle of the screen and nothing outside the level is shown. Resizing the window resizes the canvas and picks a new zoom. Holding D then W: the camera scrolls with the player, stops at the east edge while the player walks on to the wall, then stops at the north edge; the view always starts on a whole device pixel; the HUD has its own scene at zoom 1; no console errors | `proof/02-camera-*.png`, `proof/02-camera.json` |
| 03 | ticket #1's `05-browser.mjs` | The existing browser check (movement at the def speed, walls, sliding, the drawn circle where the sim says) still passes on the bigger level with the new camera. Its north walk now derives its duration from the distance to the border instead of assuming the old 16 m tall level | `proof/03-existing-browser.txt` and ticket #1's refreshed `proof/05-browser-*` |

The console output of each run is also kept as `proof/<script>.txt`.
