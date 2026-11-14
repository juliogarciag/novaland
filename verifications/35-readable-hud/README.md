# Verifications for #35 - Readable HUD: backdrop, FPS and latency

Ticket: https://github.com/juliogarciag/novaland/issues/35.

The highest-level user of this ticket is a person playing in a browser who reads the HUD: over any terrain, on any screen, solo or on a server. So the proof is Playwright against the real client, and for latency against the real room server with a TCP proxy in between that delays traffic by a known amount.

Run everything (from anywhere; installs Playwright on first run):

```bash
bash verifications/35-readable-hud/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure, and writes its proof into `proof/`.

| # | Verification | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install && pnpm test && pnpm typecheck && pnpm lint` pass; the headless tests this ticket adds exist and pass: the HUD lines (`hudLines`), the frame rate counter (`RenderedFrameRate`) and the connection's latency measurement (`WorldConnection`) | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-hud.mjs` | Solo, in Chromium: the tick counter and the movement help are gone; who you are, the player count and the dev `J` hint are kept; there is no latency. The backdrop is the text's own background: at pixel ratios 1, 1.5, 2 and 3 and after resizing the window the box sits at the same margin with the same CSS size, and in the screenshot the text is surrounded by backdrop on all four sides by the padding. Legibility is measured from screenshot pixels as the WCAG contrast of the text colour against the lightest backdrop pixel: the player is walked until the HUD covers only dirt (the lightest tile), then only trees (the darkest), then a white sheet is put over the world; all three stay above 4.5:1 (without the backdrop dirt gives 2.5:1 and white 1.2:1). The fps shown equals the rate the page really renders at, counted with the page's own `requestAnimationFrame`: at rest, with 40 ms of work burnt in every frame, and after the work stops. Nothing about fps or latency is in the sim snapshot | `proof/02-hud.json`, `proof/02-hud-over-light-tiles.png`, `proof/02-hud-over-dark-tiles.png`, `proof/02-hud-over-white.png`, `proof/02-hud-ratio-*.png`, `proof/02-hud-resized-*.png` |
| 03 | `03-latency.mjs` | Online, against the real room server through a delaying TCP proxy: the first line reads `fps N   latency N ms   1/5 online`; straight through the round trip is a few milliseconds; with 60 ms added each way the HUD shows 120 ms or a little more, with 150 ms each way 300 ms; the client sends the room's own one-byte ping once a second, the first one a second after the welcome so a page still building the game does not read as a slow network, and the server answers each; while the proxy holds all traffic the number grows with the wait, and it is small again when traffic flows; with the server gone there is no latency, and after a restart it is measured again; a player who only pings is still freed by the idle timeout (pings are not input), and once away no more pings go out | `proof/03-latency.json`, `proof/03-latency-120ms.png`, `proof/03-latency-300ms.png`, `proof/03-latency-stalled.png` |

The console output of each run is also kept as `proof/<script>.txt`.

Playwright is pinned to the version the other verifications resolved to, so the Chromium already downloaded for them is reused.
