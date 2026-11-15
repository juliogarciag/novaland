# Novaland

A 2D open world built as a long-lived playground, expanded mostly by AI agents working in parallel.

Everything an agent (or a human) needs to work here is in [AGENTS.md](AGENTS.md): the architecture rules, the package layout, the commands, and how to add a feature without breaking the rules. Architecture decisions live in [docs/decisions](docs/decisions).

```bash
pnpm install
pnpm dev        # client in the browser (PORT=5180 pnpm dev to pick a port)
pnpm test       # all tests, headless
pnpm typecheck
pnpm lint
```

## Running it yourself

The whole game is one process: a Node server that serves the built client and runs the one world room on a single port. Build it and run it anywhere a container runs, or straight on a machine with Node 24 and pnpm.

```bash
docker build -t novaland .
docker run --rm -e PORT=8080 -e ALLOWED_ORIGINS=http://localhost:8080 -p 8080:8080 novaland
```

Open http://localhost:8080/ in two browser windows and walk around. `ALLOWED_ORIGINS` is the address players type: the image runs in production mode and refuses to start without it. Without Docker:

```bash
pnpm install
pnpm build          # the client bundle (packages/client/dist) and the server bundle (packages/server/dist)
PORT=8080 pnpm start
```

What the process does and reads:

- `PORT` picks the port; the default is 2567. It serves `index.html`, the hashed bundle and the sprites from `packages/client/dist`, and the world room's matchmaking and WebSocket on the same port, so the client connects to the origin it was served from and no `VITE_SERVER_URL` is involved.
- `GET /health` answers `200` with `{ ok, roomId, seats, seatsTaken, tick, savedPositions }` for the host's health checks (`savedPositions` is `disk` or `memory`, see `DATA_DIRECTORY` below); the image's `HEALTHCHECK` already calls it.
- Browser pages may only reach the world room from an origin listed in `ALLOWED_ORIGINS` (comma-separated, `https://play.example.com,https://tunnel.example.com`). The server is told its origins and never works them out from a request, so it does not matter what `Host` a reverse proxy passes. In production (`NODE_ENV=production`, which the image sets) the list is required and the process refuses to start without it. Outside production any page on a loopback address may also reach it, which is how `pnpm start`, `pnpm dev:online` and the commands above without Docker work with nothing set. Anything else gets `403` on the matchmaking call and on the WebSocket upgrade. `ALLOWED_ORIGINS=*` turns the check off.
- Behind a reverse proxy, `X-Forwarded-Proto` must be a single `http` or `https`. A request with a malformed `Host`, another forwarded protocol or a full URL as its target is answered `400`.
- Files are compressed for browsers that accept it, and partial (range) requests work. A connection that sends a second request before the first is answered is closed, and so is one on which nothing moves for a minute or two. A seated player is never cut for being quiet.
- A busy `PORT` stops the boot.
- `CLIENT_DIR` points the server at another client build; unset, it serves `packages/client/dist` when that exists and runs the room alone when it does not.
- The world lives in the process's memory: a restart is a fresh world with a new seed, and there must be exactly one instance (one room, five seats).
- Where each player last stood is the exception. A browser keeps a secret player token and shows it when it joins, and the server puts that player back where they left ([ADR 0014](docs/decisions/0014-returning-players.md)). `DATA_DIRECTORY` names the directory that holds the file (`saved-positions.sqlite`); with it set, players return to their place after a restart too. Unset, the server uses `RAILWAY_VOLUME_MOUNT_PATH` if the host set it, and otherwise keeps positions in memory, so a restart forgets them. A directory that cannot be written stops the boot. With Docker: `-v novaland-data:/data -e DATA_DIRECTORY=/data`, and the volume must be writable by the image's `node` user.
- Production builds carry no debug API: `window.__novaland` exists only under `pnpm dev`.

Any host that runs one always-on container with WebSockets works. The public game runs on Railway, below.

## Deploying

The game is live at **https://novaland-production.up.railway.app**. Every merge to `main` deploys it: Railway's GitHub autodeploy builds the root `Dockerfile` once the CI checks on that commit pass. No deploy token is stored in GitHub. Each deploy starts an empty world, and players come back to where they stood in the last one once the volume below exists. [ADR 0009](docs/decisions/0009-hosting-on-railway.md) has the reasoning.

How the service is built and run lives in [`.railway/railway.ts`](.railway/railway.ts), Railway's Infrastructure as Code: the Dockerfile builder, the `/health` check, restart on failure, exactly one replica in US East that never sleeps, Wait for CI, the domain, `ALLOWED_ORIGINS`, and the volume `novaland-data` mounted at `/data` that keeps where players stood (with `RAILWAY_RUN_UID=0`, because Railway mounts volumes as root). After an apply that adds the volume, `GET /health` must say `"savedPositions":"disk"`; `memory` means the process found no volume. `pnpm typecheck` checks it against the SDK's types. Railway does not read that file on deploy. After changing it, apply it from the repo root with the project linked (Railway CLI 5.42.1 or newer):

```bash
railway config plan
```

```bash
railway config apply
```

The Railway account holds other projects, and an apply manages the whole project it is linked to: a file applied while linked to another project would plan to delete that project's services. Before applying, check that the plan's header reads `Project novaland` and `Environment production` and that it destroys nothing, and never pass `--confirm-destructive`.

Setting it up from nothing, once. The Novaland project is its own Railway project and shares nothing with other projects in the account:

1. Create the project: `railway init --name novaland` at the repo root (it also links the folder), or New Project → Empty Project in the dashboard and then `railway link`.
2. Connect the repo: give Railway's GitHub app access to `juliogarciag/novaland` only ("Only select repositories", in the dashboard under Account Settings → GitHub).
3. Remove the `networking` line from the file, since a new project gets a domain of its own, then run `railway config apply`. It creates the `novaland` service from `main` with every other setting, including Wait for CI (`checkSuites`) and `ALLOWED_ORIGINS`, and Railway starts a first deploy. Wait for CI shows under the service's Settings → Source, because `.github/workflows/ci.yml` runs on pushes to `main`.
4. Generate the domain: `railway domain --service novaland`, or the service's Settings → Networking → Generate Domain. Put its name back in the file's `networking` line, and check that `railway config plan` reports nothing to do.
5. `ALLOWED_ORIGINS` is `https://${{RAILWAY_PUBLIC_DOMAIN}}`, which Railway fills in from the domain. Before the domain exists it is not a valid origin and the server refuses to boot, so the first deploy from step 3 fails. Run `railway redeploy --service novaland` once the domain exists. A second address, such as a custom domain, goes into the file as a comma-separated list.
