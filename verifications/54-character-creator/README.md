# Verifications for #54 - Character creator: pick a look and a name on join

Ticket: https://github.com/juliogarciag/novaland/issues/54. Decision: [ADR 0015](../../docs/decisions/0015-player-character.md) (where the look and the name live, and the one rule for a legal character).

The highest-level user of this ticket is a person who opens the game for the first time, makes a character, and then sees it, and everyone else's, in the world with a name above it. The second user is a stranger who talks to the room directly and tries to get an illegal character in. So the proof is Playwright against the real client and the real room server, plus a client that speaks the protocol with no creator in between.

Run everything (from anywhere; the first run installs Playwright in the folder):

```bash
bash verifications/54-character-creator/run.sh
```

Each script prints `PASS`/`FAIL` lines, exits non-zero on failure and writes its proof into `proof/`. Last run: 53 checks, 53 passed.

| # | Script | What it proves | Proof |
|---|---|---|---|
| 01 | `01-check.mjs` | `pnpm install`, `pnpm typecheck`, `pnpm lint` and every test pass, and the headless tests this ticket adds exist and pass: the name rule (normalised, counted in visible characters, refused when not text, empty, too long, invisible, or holding control characters or misplaced joiners; real scripts and emoji sequences kept), the character rule (every palette index and nothing outside, never throws), a join spawning the character it carried, a malformed join seating nobody, the sim fuzzed with thousands of hostile joins against an oracle written in the test, the name in the snapshot as numbers, a character on a replica (full state, delta, and whatever a lying server sends), determinism, the server's gate and its fuzz, two characters over a real connection, the client rejoining as its character, the remembered character, the palette swap. `pnpm sim:headless` still runs | `proof/01-check-output.txt`, `proof/01-tests.json` |
| 02 | `02-solo.mjs` | Solo (`pnpm dev`), in Chromium: a first visit shows the creator and no game; an empty name, 21 characters and a control character keep the player on the creator with the reason; picking swatches repaints the preview; entering the world plays as that character, drawn in its three colours and no other palette colour (read from the texture it is drawn from) with its name right above it; the HUD names the player; the browser remembers the character and a reload goes straight in; the Change character button opens the creator at `#creator`, prefilled, and what it makes replaces the old character; a second seat is a second, differently named character; a remembered character that is no longer legal opens the creator | `proof/02-solo-*.png`, `proof/02-solo.json` |
| 03 | `03-online.mjs` | Two browsers against one real world room: the creator shows before any join request; each browser makes a different character and both see both, each in its own colours with its own name above it, also after one walks; each HUD names its own player. Then the edge, from a client that speaks the protocol directly: 313 malformed joins (a palette index out of range, negative or fractional, a 21-character and a 900-character name, a name that is a number or an object, an empty name, a line break, a text-direction override, a smuggled slot, no character, options too big, and 300 random ones) are each refused as `invalid-character`; a 5000-character name is cut off by the HTTP front (413); none takes a seat or shows up in either browser and the server keeps running; a name sent with stray spaces arrives normalised. When a player leaves its name label goes with it, and a seat and entity id taken over by another player shows the new name and colours. A page whose remembered character the real room refuses (the join is altered on the way) shows the `character-refused` screen, whose one button opens the creator. A reload does not ask again; after the server restarts both pages rejoin by themselves as the same two characters | `proof/03-online-*.png`, `proof/03-online.json` |

The console output of each run is kept as `proof/<script>.txt`.

`pages.mjs` holds what the two browser scripts share (driving the creator, reading what the game shows); `processes.mjs` adds a command run to completion and a port probe to the template's `lib.mjs`.
