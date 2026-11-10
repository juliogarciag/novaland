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
- `GET /healthz` answers `200` with `{ ok, roomId, seats, seatsTaken, tick }` for the host's health checks; the image's `HEALTHCHECK` already calls it.
- Browser pages may only reach the world room from an origin listed in `ALLOWED_ORIGINS` (comma-separated, `https://play.example.com,https://tunnel.example.com`). The server is told its origins and never works them out from a request, so it does not matter what `Host` a reverse proxy passes. In production (`NODE_ENV=production`, which the image sets) the list is required and the process refuses to start without it. Outside production any page on a loopback address may also reach it, which is how `pnpm start`, `pnpm dev:online` and the commands above without Docker work with nothing set. Anything else gets `403` on the matchmaking call and on the WebSocket upgrade. `ALLOWED_ORIGINS=*` turns the check off.
- Behind a reverse proxy, `X-Forwarded-Proto` must be a single `http` or `https`. A request with a malformed `Host`, another forwarded protocol or a full URL as its target is answered `400`.
- Files are compressed for browsers that accept it, and partial (range) requests work.
- `CLIENT_DIR` points the server at another client build; unset, it serves `packages/client/dist` when that exists and runs the room alone when it does not.
- The world lives in the process's memory: a restart is a fresh world with a new seed, and there must be exactly one instance (one room, five seats).
- Production builds carry no debug API: `window.__novaland` exists only under `pnpm dev`.

The host itself is not chosen here; whatever runs one always-on container with WebSockets works.
