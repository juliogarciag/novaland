# 0008 - The server's HTTP edge: its own half, libraries for the work, Colyseus's hooks for the wiring

Status: accepted. Date: 2026-11-10. Builds on [0004](0004-multiplayer-netcode.md) and [0005](0005-world-room-join.md), which fix the room, and covers what ticket #19 put in front of it: the client files, the health check, the origin policy and the request limits. It replaces the first version of that edge and absorbs ticket #30.

## Context

One process serves the built client and the world room on one port. The first version of #19 wrote every part of that by hand and installed each part by taking Colyseus's listeners off the HTTP server and re-dispatching to them. Three things were wrong with it.

- The order of the handlers was the reverse of the order they were installed in and existed nowhere as a list. It depended on when Colyseus installs its listeners and how many, and Colyseus rearranges them itself.
- The hand-written parts missed cases that libraries cover. The file server ignored range requests and sent nothing compressed. The origin check compared `Origin` with the request's `Host`, which a domain pointed at the server's address (DNS rebinding) satisfies, and which fails real players behind a proxy that rewrites `Host`.
- Nobody had sent Colyseus a malformed request. Its router builds a URL from `X-Forwarded-Proto`, `Host` and the request target, and throws outside any handler when that does not parse. One such request from anyone ended the process. This is in Colyseus 0.18.27 and was there before #19.

Two reviews and three security passes read the code and missed the last point. Sending bytes found it in ten minutes, and found four more problems in the rebuild over two rounds. That is the reason for this record: the edge of a public server is not the place for code that is only as good as the cases its author thought of, and it is tested by attacking it.

## Decision

### Two halves that never import each other

- `packages/server/src/edge/` is everything between the port and the room. It imports Express, `helmet` and `compression`, and never Colyseus or the world.
- `packages/server/src/world/` is the room. It never imports the edge or an HTTP library. It declares what it needs in `WorldFront` and hands each piece to the Colyseus hook made for it.
- Each half has one entry file (`edge/index.ts`, `world/index.ts`). The rest of the server imports nothing else from it, and neither half imports anything from outside its own folder. `src/startServer.ts` is the only file that joins them; `src/index.ts` reads the environment, with a helper from each entry file.
- Lint enforces the import rules (`eslint.config.js`), the way it enforces the sim's package boundary. It does not see a dynamic `import()`. A real package was not needed: one process uses the edge, and the entry file is already the surface a package would have.

### Libraries do the work

- `express.static` serves the client: conditional and range requests, `HEAD`, no dotfiles, no path out of the directory. Files under `assets/` are cached for a year, because Vite names them by a hash of their content.
- `helmet` writes the security headers. The Content-Security-Policy lists what the bundle needs. HSTS is off: whether the site is HTTPS-only is the host's decision.
- `compression` compresses whole responses, not ranges.
- Express is already a peer of Colyseus's transport. The new dependencies are `helmet`, `compression` and the type packages for Express and `compression`.

### Colyseus's hooks do the wiring

- The edge creates the HTTP server and the transport listens on it (`WebSocketTransport({ server })`).
- The routes are mounted through Colyseus's `express` option.
- Colyseus's `beforeUpgrade` hook is not used. With it set, the transport parses the upgrade's target before the hook runs and throws on one that is not a URL, and it never closes a socket the hook refuses. The origin policy on upgrades runs in the guard below.
- The matchmaker's `getCorsHeaders` is replaced, and `Access-Control-Allow-Origin: *` is taken out of its defaults, so an answer Colyseus writes names an origin only when the policy allows it.

### The origin policy is told, never inferred

- `ALLOWED_ORIGINS` lists the origins players open. Outside production any loopback page is also allowed, which is the dev flow. The policy never reads `Host`.
- Production with nothing listed refuses to boot. The cost is one variable per deployment. The alternative, trusting `Host`, is what rebinding defeats.
- An `Origin` header is accepted only in the exact spelling browsers send, so what is allowed is what a browser compares.
- A request with no `Origin` passes: it is not a browser page. The game has no cookies or accounts yet, so the check stops other sites from using visitors' browsers and nothing more. It becomes essential the day sessions carry authority. Before that day, `ALLOWED_ORIGINS=*` must stop naming the caller alongside `Access-Control-Allow-Credentials`.

### One guard, the only place listeners are taken over

Colyseus answers its own routes before the Express app, with no hook in front of them, and its hook in front of upgrades cannot be used. So `edge/guardRequests.ts` wraps the single `request` listener and the single `upgrade` listener Colyseus installs, right after it binds its routes, and refuses to install over any other number.

| Answer | For |
|---|---|
| `400` | A request or upgrade Colyseus cannot survive: a target that is not a path, a `Host` that is not `host[:port]`, an `X-Forwarded-Proto` that is not one `http` or `https` |
| `403` | An upgrade, or a state-changing request (anything but `GET` and `HEAD`), from an origin the policy does not allow: the upgrade is the way into the room and matchmaking reserves a seat |
| `413` | A body over the edge's cap, which the guard reads first, because Colyseus reads bodies with no limit (#17's cap, moved) |
| Connection closed | A request sent before the answer to an earlier one on the same connection is out |

The last row is not about Colyseus. Node starts pipelined requests at once and queues their answers. When the client hangs up, the queued answers never learn it, and every file `express.static` opened for them stays open for good. Browsers and proxies send one request at a time on a connection. The guard tells a queued answer by its missing socket, which also covers an earlier request Node answered itself.

A refused request or upgrade has its connection destroyed, not only ended, so a client that stays on or sends more holds nothing open.

## Consequences

- `handleFirst.ts`, `serveClientFiles.ts`, `refuseForeignOrigins.ts` and `answerHealthChecks.ts` are gone. What remains hand-written is the origin list and the guard.
- New HTTP routes go in `edge/mountEdgeRoutes.ts`. Nothing but the guard calls `httpServer.on('request')`.
- The guard depends on one fact about Colyseus: it serves all HTTP from one listener and all upgrades from another, bound when the port opens. The guard checks both counts at boot, and `startServer.test.ts` sends the crashing requests through the real composition, so a Colyseus upgrade that changes either fails loudly. If Colyseus fixes its parsing and adds a body limit, the `400` and `413` rows can go.
- A proxy that sends a list in `X-Forwarded-Proto` (`https, http`) gets `400`. Colyseus would crash on it. A deployment behind two proxies must make the outer one overwrite the header.
- A connection on which no byte moves is closed after a minute, so a client that never reads a file does not hold it open for good (measured: up to two minutes for a stalled download). An upgrade that stalls in its handshake is closed the same way. A seated player is never cut: the transport clears the timeout for a connection it accepts and pings it itself.
- A busy port fails the boot. Colyseus only logged it and waited for ever.
- `/healthz` answers `503` until the room exists.
- Local runs of the image need `ALLOWED_ORIGINS` (`-e ALLOWED_ORIGINS=http://localhost:8080`), because the image is production.
- Not done here, for ticket #20's host to cover:
  - Nothing bounds how many connections one client holds, nor how slowly it reads.
  - Matchmaking is not rate-limited. A client that is not a browser can reserve seats, three seconds at a time. A per-address budget must not read the address from `X-Forwarded-For` unless the proxy overwrites it: Colyseus takes the first hop, which any client can set.
  - Colyseus still logs a stack trace for some junk an anonymous client can send (a matchmaking body that is not JSON, a malformed frame from a seated client).
