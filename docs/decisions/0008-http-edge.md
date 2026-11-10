# 0008 - The server's HTTP edge: its own half, libraries for the work, Colyseus's hooks for the wiring

Status: accepted. Date: 2026-11-10. Builds on [0004](0004-multiplayer-netcode.md) and [0005](0005-world-room-join.md), which fix the room, and covers what ticket #19 put in front of it: the client files, the health check, the origin policy and the request limits. It replaces the first version of that edge and absorbs ticket #30.

## Context

One process serves the built client and the world room on one port. The first version of #19 wrote every part of that by hand and installed each part by taking Colyseus's listeners off the HTTP server and re-dispatching to them. Three things were wrong with it.

- The order of the handlers was the reverse of the order they were installed in and existed nowhere as a list. It depended on when Colyseus installs its listeners and how many, and Colyseus rearranges them itself.
- The hand-written parts missed cases that libraries cover. The file server ignored range requests and sent nothing compressed. The origin check compared `Origin` with the request's `Host`, which a domain pointed at the server's address (DNS rebinding) satisfies, and which fails real players behind a proxy that rewrites `Host`.
- Nobody tested what Colyseus does with a malformed request. Its router builds a URL from `X-Forwarded-Proto`, `Host` and the request target, and throws outside any handler when that does not parse. One such request from anyone ended the process. This is in Colyseus 0.18.27 and was there before #19.

Two reviews and three security passes missed the last point. The lesson is the reason for this record: the edge of a public server is not the place for code that is only as good as the cases its author thought of.

## Decision

### Two halves that never import each other

- `packages/server/src/edge/` is everything between the port and the room. It imports Express, `helmet` and `compression`, and never Colyseus or the world.
- `packages/server/src/world/` is the room. It never imports the edge. It declares what it needs in `WorldFront` and hands each piece to the Colyseus hook made for it.
- Each half has one entry file (`edge/index.ts`, `world/index.ts`), and the rest of the server imports nothing else from it. `src/startServer.ts` is the only file that imports both. `src/index.ts` only reads the environment.
- Lint enforces all of it (`eslint.config.js`), the way it enforces the sim's package boundary. A real package was not needed: one process uses the edge, and the entry file is already the surface a package would have.

### Libraries do the work

- `express.static` serves the client: conditional and range requests, `HEAD`, no dotfiles, no path out of the directory. Files under `assets/` are cached for a year, because Vite names them by a hash of their content.
- `helmet` writes the security headers. The Content-Security-Policy lists what the bundle needs. HSTS is off: whether the site is HTTPS-only is the host's decision.
- `compression` compresses the responses.
- Express is already a peer of Colyseus's transport, so only `helmet` and `compression` are new dependencies.

### Colyseus's hooks do the wiring

- The edge creates the HTTP server and the transport listens on it (`WebSocketTransport({ server })`).
- The routes are mounted through Colyseus's `express` option.
- The origin policy on WebSocket upgrades runs in Colyseus's `beforeUpgrade` hook.
- The matchmaker's `getCorsHeaders` is replaced, and `Access-Control-Allow-Origin: *` is taken out of its defaults, so a matchmaking answer names an origin only when the policy allows it.

### The origin policy is told, never inferred

- `ALLOWED_ORIGINS` lists the origins players open. Outside production any loopback page is also allowed, which is the dev flow. The policy never reads `Host`.
- Production with nothing listed refuses to boot. The cost is one variable per deployment. The alternative, trusting `Host`, is what rebinding defeats.
- A request with no `Origin` passes: it is not a browser page. The game has no cookies or accounts yet, so the check stops other sites from using visitors' browsers and nothing more. It becomes essential the day sessions carry authority.

### One guard, the only listener taken over

Colyseus answers its own routes before the Express app and offers no hook in front of them. So `edge/guardRequests.ts` wraps the single `request` listener Colyseus installs, right after it binds its routes, and refuses to install over any other number. It answers:

- `400` to a request Colyseus cannot survive: a target that is not a path, a `Host` that is not `host[:port]`, an `X-Forwarded-Proto` that is not one `http` or `https`;
- `403` to a state-changing request (anything but `GET` and `HEAD`) from an origin the policy does not allow, because matchmaking reserves a seat;
- `413` to a body over `MAX_REQUEST_BODY_BYTES`, which it reads first, because Colyseus reads bodies with no limit (this part is #17's cap, moved).

WebSocket upgrades need no wrap. Every malformed upgrade tried against the transport was answered `400` by Node, `ws` or Colyseus.

## Consequences

- `handleFirst.ts`, `serveClientFiles.ts`, `refuseForeignOrigins.ts` and `answerHealthChecks.ts` are gone. What remains hand-written is the origin list (about thirty lines of logic) and the guard.
- New HTTP routes go in `edge/mountEdgeRoutes.ts`. Nothing calls `httpServer.on('request')`.
- The guard depends on one fact about Colyseus: it serves all HTTP from one listener, bound when the port opens. The guard checks that count at boot and `startServer.test.ts` sends the crashing requests through the real composition, so a Colyseus upgrade that changes either fails loudly. If Colyseus fixes its router and adds a body limit, the `400` and `413` parts can go; the `403` part stays until Colyseus has a hook in front of matchmaking.
- A proxy that sends a list in `X-Forwarded-Proto` (`https, http`) gets `400`. Colyseus would crash on it. A deployment behind two proxies must make the outer one overwrite the header.
- `/healthz` answers `503` until the room exists, where the first version answered nothing.
- Local runs of the image need `ALLOWED_ORIGINS` (`-e ALLOWED_ORIGINS=http://localhost:8080`), because the image is production.
- Not done here: rate limiting of matchmaking. A client that is not a browser can still reserve seats, three seconds at a time. That needs a per-address budget, which belongs with whatever the host puts in front (ticket #20).
