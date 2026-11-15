# 0014 - Returning players: a token the browser keeps, positions in SQLite on a volume, and a join command that says where

Status: accepted. Date: 2026-11-15. From ticket #55. Builds on [0004](0004-multiplayer-netcode.md) and [0005](0005-world-room-join.md) (the join) and on [0009](0009-hosting-on-railway.md) (the host). Changes two of their consequences: 0005's "a dropped connection ... joins again as a new session" still holds for the session and the seat, but the player now comes back to where they were; 0009's "every deploy drops the world" still holds for the world, but no longer for where each player stood.

## In short

A player who closes the tab, loses the connection or is freed for being idle comes back to the spot they left, also after the server restarts or a new version is deployed.

There are no accounts. The first time a browser opens the game it makes up a long random secret, the **player token**, and keeps it. Every time it joins it shows the token. The server keeps a small table, "this player was last at this point", in a file on a disk that outlives deploys. When a token it knows joins, the server itself tells the sim "this player joins, at this point". The browser never says where it wants to be.

## Context

- The world lives in one process's memory and each deploy starts a fresh one (ADR 0009). Railway's container disk is thrown away on every deploy.
- The sim is deterministic and does no I/O (rule 5); input reaches it only as commands (rule 2). A join carried no position: the sim picked a spawn.
- A join carries options the client writes (`JoinOptions`), so anything in them is untrusted.
- Five seats, one room, one replica. The data is tiny: one point per player.

## Decision

### Who a player is

- **The player token** is 32 bytes from the browser's cryptographic generator, written as 43 base64url characters, kept in `localStorage` under `novaland.playerToken` and sent as `JoinOptions.playerToken`. Every tab of one browser is the same player; clearing site data makes a new one. A browser that refuses storage gets a token that lasts as long as the page.
- **The token is a credential and stops at the gate.** `readPlayerKey` in `world/inbound.ts` checks its shape (`isPlayerToken`, defined once in the sim's wire file) and returns the SHA-256 of it, the **player key**. The room, the store and the log only ever hold the key. The key cannot be presented in a join and cannot be turned back into a token, so a copy of the store's file opens nobody's seat. Neither is ever put in a message to a client or in a log line (a test reads every message and every log line of a session for both).
- A join with no token, or with one of the wrong shape, is a new player. It is not refused: an old page, a script and a test all still get in.
- The token is a field of the join options, not Colyseus's `onAuth`. `onAuth` exists for exactly this and would carry the token in an `Authorization` header, but it rejects or accepts a join, and here a missing or unknown token must be accepted. Reading one more field next to `protocol` in `onJoin` is the smaller change and the one ticket #54 (which adds its own fields to the same options) merges with cleanly. No change to `WIRE_PROTOCOL`: the field is optional in both directions.

### Where positions are kept

- **SQLite, through Node's built-in `node:sqlite`, in one file, `saved-positions.sqlite`.** One table: player key, x, y, when last seen. Opened once at boot by `index.ts`, handed to the room through `startServer`, closed after the room has stopped.
- **The file lives in `DATA_DIRECTORY`**, or, when that is unset, in `RAILWAY_VOLUME_MOUNT_PATH`, which Railway sets by itself on a service with a volume. With neither, positions are kept in memory (the same code, SQLite's `:memory:`) and a restart forgets them: that is the dev server. A directory that was asked for and cannot be opened stops the boot, like a bad `CLIENT_DIR`; running on would quietly forget everyone at the next deploy, and on Railway a deploy that does not come up healthy leaves the previous one serving.
- **`GET /health` reports `savedPositions: "disk" | "memory"`** so the human can see, after a deploy, which one production runs.
- **On Railway the directory is a volume** mounted at `/data`, declared in `.railway/railway.ts`. Railway mounts volumes as root and the image runs as `node`, so the service also gets `RAILWAY_RUN_UID=0` (Railway's documented switch for this). The human applies the file; nothing provisions it from a merge.

Why this and not the others:

| Option | Why not |
|---|---|
| A JSON file written by hand | Has to earn what SQLite gives for free: atomic replace, not rewriting every player to save one, surviving a crash mid-write. The project prefers a library over hand-written infrastructure. |
| `better-sqlite3` | The same engine, but a native module: a compile or a prebuilt binary for Alpine in the image, and a build-script allowance in pnpm. `node:sqlite` ships inside the Node 24 the image already runs. |
| Railway Postgres or Redis | A second service, a connection string, a client library, async calls in the join and network failure modes, for a table of five live rows. Right when there is more than one server process; there is exactly one (ADR 0009). |
| Colyseus `allowReconnection` | Keeps a seat for a dropped client for some seconds inside one process. It does not survive a restart, and ADR 0005 turned `reconnect` off on purpose. |
| The browser remembers its own position and sends it | A client would choose where it appears. Rejected by rule 1. |

`node:sqlite` is marked experimental in Node 24 and prints one `ExperimentalWarning` line at boot. The surface used is `DatabaseSync`, `exec`, `prepare`, `get`, `run`, `close`, all behind the `SavedPositions` interface in `world/savedPositions.ts`, so replacing it is one file. Its calls are synchronous and run on the room's loop, so a save must never wait for the disk: the file is opened with a write-ahead log and `synchronous = NORMAL` (a save is appended, not synced; a crash of the process loses nothing, a power cut may lose the last saves but not the file), and a player who has not moved since their last save is not written again, so a join, a leave or a takeover that changes nothing costs no write.

### How the position reaches the sim

- **`JoinCommand` gains an optional `returnTo: { x, y }`.** The room sets it from its own record and from nothing else. A client cannot send a `player/join` at all (the room builds every command and reads only `protocol` and `playerToken` from the options), so no field of a join, under any name, moves a player. The join fuzz sends 600 option objects with positions under every name the code uses and checks each player appears next to the spawn.
- **The sim decides the final point** (`pickReturnPoint`): the exact point if its tile is still walkable and no player stands on it, else the centre of the nearest free tile within 8 tiles, else a normal spawn. No randomness. Positions are metres from an origin that never moves (ADR 0013), so a saved point means the same place after the map grows. A point past the world's limit is refused before the search: the fuzz found that tile numbers that large never finish counting.
- **The room reads positions through a new export, `getPlayerPosition(sim, slot)`**, and only for a session it has welcomed. Before the tick that spawns a session's player, its slot can still hold the player who had the seat before, and saving that under the new player's key would hand one player another's place.

### When positions are saved

- When a seat is freed: a leave, a dropped connection, an idle kick, a takeover.
- Every `POSITION_SAVE_INTERVAL_MS` (5 s) for every seated player. That is what a crash loses.
- When the room is disposed (a stop on `SIGTERM`, which is how a deploy ends the old process).

In all three, a player who stands where their last save put them is skipped.

### One token, one player

A join whose token already holds a seat **takes the player over**: the older session's seat is freed, it is closed with code 4101 (`REPLACED_KICK`, `joined-elsewhere`), and the new session's player appears where the old one stood, from the live position, not the last save. The world never holds two players for one token. The newest join wins because the older session may be a connection the player has already lost and the server has not yet noticed; refusing the new join would lock a player out of their own character.

The client that receives 4101 shows a screen (`data-screen="elsewhere"`, "You are playing in another tab or window") and does not rejoin by itself, or two tabs would take the player from each other for ever. "Play here" joins again and takes the player back.

### Keeping the store bounded

Tokens are free to make up, so two limits:

- **A new token earns a row only after its session has held a seat for `NEW_PLAYER_SAVE_AFTER_MS` (10 s).** With five seats, rows are added no faster than five every ten seconds, however fast someone joins. A token the store already knows is saved from its first tick.
- **The store holds at most `MAX_SAVED_PLAYERS` (100,000) rows**; saving one more forgets whoever was last saved longest ago (a save happens when a player has moved, so that is when they last walked). A row is under 100 bytes, so the file stays near ten megabytes.

One seat held by a script adds one row every ten seconds, so pushing out every player seen before it started takes that seat eleven and a half days, and all five seats more than two days. It does not need the whole world: one seat is enough, slowly, and the game stays playable meanwhile. Nothing here stops that; a limit on joins per address would, and is not in this ticket.

## Consequences

- A first-time player who leaves within ten seconds is not remembered and spawns again. They had not gone anywhere.
- Only the position comes back. The avatar is still picked by the sim on every join; the look and the name are ticket #54's, which keeps them in the browser.
- A full world cannot be taken over into: Colyseus refuses the join of a sixth session before any room code runs (ADR 0005), so a player whose dropped connection still holds the fifth seat waits until the server notices the drop.
- Whoever holds a token is that player. It lives in `localStorage` of the game's origin, so anything that can run script on the page can read it; the page loads no third-party script (ADR 0008's content security policy). What a stolen token buys is standing where someone stood.
- The world now has state outside the process. There is still exactly one replica: a volume attaches to one, and SQLite in a file has one writer.
- Root in the container on Railway is the price of the volume there. The image itself still declares `USER node`, so every other host runs it unprivileged, and `DATA_DIRECTORY` can point at any directory that user can write.
- Solo mode does not restore a position. The command would allow it; nothing saves one there yet.
- A later feature that wants more per player (inventory, facing) adds a column or a table next to this one and another optional field to the join command; the key and the gate stay.
