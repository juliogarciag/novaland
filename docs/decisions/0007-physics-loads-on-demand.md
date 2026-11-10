# 0007 - Physics loads on demand

Status: accepted. Date: 2026-11-10. Builds on [0002](0002-physics.md), which fixes Rapier's deterministic `compat` build inside the sim, and [0006](0006-client-online-mode.md), which makes a production client a replica of the server's world (ticket #19).

## Context

The `compat` build embeds Rapier's WASM as base64 in its JavaScript, so it loads in Node and in Vite with no setup (0002). The sim imported it statically in `core/physics.ts`, and every feature imports `core/physics` for its body helpers. A client that only holds a replica still imports the features, because they register the components a world state names. So the whole of Rapier landed in the client's one bundle: 3.4 MB of a 5.1 MB file, about three quarters of it gzipped. A production page always joins the server that served it and never creates a sim, so it never runs any of that code.

## Decision

- `core/physics.ts` imports Rapier's types only. `initPhysics()` loads the module itself with a dynamic `import()`, runs its `init()` and keeps it. The body helpers and `createPhysicsWorld` read it through `loadedRapier()`, which throws if `initPhysics` has not finished. They only run inside a sim, and `createSim` awaits `initPhysics` before it builds one, so in practice they never throw.
- No other file imports Rapier at runtime. `core/sim.ts` keeps its type-only import.
- Bundlers split the dynamic import into its own chunk: `assets/rapier-*.js` in the client build and in the server's SSR build. The page's `index.html` does not reference it. A replica-only page never fetches it, and a solo page fetches it when `createSim` first runs.

## Consequences

- The production client bundle drops from 5.1 MB to 1.7 MB, or from 1.77 MB to 0.45 MB gzipped. Solo play pays the same bytes as before, one request later.
- Determinism is unchanged. The same build runs with the same seed. `pnpm sim:headless` still prints the hash recorded before the change, and `core/determinism.test.ts` passes.
- The server's `dist/` is now a directory with a chunk, not one file. The Dockerfile already copies the whole directory.
- A new runtime import of Rapier anywhere in the sim would pull it back into the main bundle. Keep runtime use inside `core/physics.ts`, and import only types elsewhere. Ticket #19's `verifications/19-one-process/02-built-server.mjs` fails if the page's bundle inlines a WASM-sized base64 string again, or if a production page requests the Rapier chunk.
