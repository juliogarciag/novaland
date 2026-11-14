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
- `GET /health` answers `200` with `{ ok, roomId, seats, seatsTaken, tick }` for the host's health checks; the image's `HEALTHCHECK` already calls it.
- Browser pages may only reach the world room from an origin listed in `ALLOWED_ORIGINS` (comma-separated, `https://play.example.com,https://tunnel.example.com`). The server is told its origins and never works them out from a request, so it does not matter what `Host` a reverse proxy passes. In production (`NODE_ENV=production`, which the image sets) the list is required and the process refuses to start without it. Outside production any page on a loopback address may also reach it, which is how `pnpm start`, `pnpm dev:online` and the commands above without Docker work with nothing set. Anything else gets `403` on the matchmaking call and on the WebSocket upgrade. `ALLOWED_ORIGINS=*` turns the check off.
- Behind a reverse proxy, `X-Forwarded-Proto` must be a single `http` or `https`. A request with a malformed `Host`, another forwarded protocol or a full URL as its target is answered `400`.
- Files are compressed for browsers that accept it, and partial (range) requests work. A connection that sends a second request before the first is answered is closed, and so is one on which nothing moves for a minute or two. A seated player is never cut for being quiet.
- A busy `PORT` stops the boot.
- `CLIENT_DIR` points the server at another client build; unset, it serves `packages/client/dist` when that exists and runs the room alone when it does not.
- The world lives in the process's memory: a restart is a fresh world with a new seed, and there must be exactly one instance (one room, five seats).
- Production builds carry no debug API: `window.__novaland` exists only under `pnpm dev`.

Any host that runs one always-on container with WebSockets works. The public game runs on Railway, below.

## Deploying

The game is live at **PUBLIC_URL**. Every merge to `main` deploys it: Railway's GitHub autodeploy builds the root `Dockerfile` once the CI checks on that commit pass. No deploy token is stored in GitHub. Each deploy starts an empty world. [ADR 0009](docs/decisions/0009-hosting-on-railway.md) has the reasoning.

How the service is built and run lives in [`.railway/railway.ts`](.railway/railway.ts), Railway's Infrastructure as Code: the Dockerfile builder, the `/health` check, restart on failure, exactly one replica in US East that never sleeps, Wait for CI, and `ALLOWED_ORIGINS`. Railway does not read that file on deploy. After changing it, apply it from the repo root with the project linked (Railway CLI 5.42.1 or newer):

```bash
railway config plan
```

```bash
railway config apply
```

Setting it up from nothing, once. The Novaland project is its own Railway project and shares nothing with other projects in the account:

1. Create the project: `railway init --name novaland` at the repo root, or New Project → Empty Project in the dashboard and then `railway link`.
2. Connect the repo: give Railway's GitHub app access to `juliogarciag/novaland` (dashboard, Account Settings → GitHub). Then `railway config apply` creates the `novaland` service from `main` with every setting above.
3. Turn on Wait for CI: the file sets it (`checkSuites`). Check it under the service's Settings → Source, where the toggle shows because `.github/workflows/ci.yml` runs on pushes to `main`.
4. Generate the domain: `railway domain`, or the service's Settings → Networking → Generate Domain.
5. Set `ALLOWED_ORIGINS`: the file sets it to `https://${{RAILWAY_PUBLIC_DOMAIN}}`, which Railway fills in from the domain. With no domain yet the value is not a valid origin and the server refuses to boot, so generate the domain before the first deploy, or redeploy after it. A second address (a custom domain) goes into the file as a comma-separated list.
