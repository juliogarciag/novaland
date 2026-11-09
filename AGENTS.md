**The project**

This is a 2d open world that we're gonna expand with time. It is a playground: features will grow without a clear limit, mostly through AI agents working in parallel. The architecture below exists so that many agents can add things at once without breaking each other.

**Development process**

- This is the repository: https://github.com/juliogarciag/novaland.
- We're gonna use a GitHub project to manage tickets: https://github.com/users/juliogarciag/projects/1.
- You can create tickets on your own.
- The session where a request arrives never does the work itself, even when the human is in the middle of a conversation there. It creates the ticket, defines a short title for it (let's call it `ticketTitle`) and its kebab-case version (`ticketKebabTitle`), starts a new agent session named `[ticketNumber] - {ticketTitle}`, and stays in the conversation with the human. Questions and discussion go on there as before.
- The new session takes over the ticket: it assigns the ticket to itself and does everything below.
  - Size the ticket before any work starts. State Small, Medium or Large with a one-line reason as the first thing you do, then proceed; nobody has to confirm. A `size:S`, `size:M` or `size:L` label on the ticket overrides what you state. When a ticket fits no tier, pick the next one up.
    - Small is docs, config, a copied skill, or a data-only entry such as a new def or level. It gets 1 independent review (a sub-agent). It gets a security pass only if the change reads untrusted input (a command handler does) or deletes or sends anything. Its verification is running the change once with proof: a screenshot, a command transcript or a test run.
    - Medium is a feature built the way "How to add a feature" describes: its own folder under `features/`, the one-line edits to the shared files that rule 10 lists, the export a view needs from `sim/src/index.ts`, and the client code that draws it. None of that counts as cross-package or core. It gets 2 independent reviews, a security pass, and the end-to-end verification the verifications bullet below describes.
    - Large is any other change under `packages/sim/src/core`, a change to how the packages talk to each other, new architecture, or a choice that needs an ADR. It gets 3 independent reviews, a security pass, an ADR, and the same end-to-end verification.
  - Review rounds are capped for every tier: apply must-fix findings and re-review once. If the second round still finds a must-fix, fix it and say so in the PR; there is no third round, the human's PR review is the last check. Should-fix findings go into one follow-up commit, which is not reviewed, or into a ticket.
  - When you start to work, create a git worktree named `{ticketNumber}-{ticketKebabTitle}` with a branch of the same name.
  - Then, think of the verifications you need to run to be sure your work is complete, and store them in a folder called `verifications/{ticketNumber}-{ticketKebabTitle}`. You can use any code you want in these verifications. The verifications are very important and have to validate your work in its entirety, from the perspective of the highest-level user of the ticket, which means user-facing features need verifications that are equal in scope to end-to-end tests. A Small ticket's folder holds only the proof of running the change once.
  - Then, they should work until the work is done. The work is only done when:
    - The verifications are true.
    - There's proof for the verifications. Proof consists of screen captures, reports, or any asset that verifies that the verification passed.
    - The independent code reviews (sub-agents) the ticket's size calls for have run and passed.
    - A security pass has been completed, when the ticket's size calls for one.
  - When the work is done, it should create a PR. Tickets should aim for a 1-to-1 relationship with PRs.
  - When the PR is ready, the result must be ready to try, without being asked: leave a dev server running from the worktree on a pinned port (`PORT=<n> pnpm dev`, see "Worktrees and ports"), open it in the browser pane, and put the URL and the proof screenshots in the final message. The human should be able to play the change the moment they read the message. Keep the server running until the PR is merged or the human stops it.
  - The session then stays open for regular feedback loop with the human in charge.
  - Once the PR has been approved by a human, you merge it.

**Stack**

- TypeScript (strict), pnpm workspaces, Vite.
- Phaser 4: rendering and input only, in `packages/client`.
- Rapier 2D (`@dimforge/rapier2d-deterministic-compat`): all physics, in `packages/sim`. Phaser Arcade/Matter physics are never used.
- bitECS: entities and components, in `packages/sim`.
- Vitest: all tests. They run headless in Node.
- Colyseus 0.18 (`colyseus` on the server, `@colyseus/sdk` for clients): the authoritative multiplayer server in `packages/server`. One `WorldRoom` owns the only live sim and steps it; browsers hold a replica (ADR 0004). `PORT=<n> pnpm --filter @novaland/server dev` runs it.

**Repository layout**

```
packages/
  sim/        All game logic and state. Plain TS. No Phaser, no DOM, no Node APIs.
    src/
      index.ts            Public API. The ONLY file client/server may import from.
      core/               Sim class, fixed-step loop, components, physics, rng, snapshot, view.
      content/            Data: the defs registry, levels (ASCII tile grids), tuning values.
      features/<name>/    One folder per feature: components, defs, commands, systems, tests.
      features/index.ts   The list of features the sim runs (one line per feature).
  client/     Phaser app. Reads sim state, draws it, turns input into commands. No game rules.
    src/main.ts, src/scenes/, src/loop/, src/input/, src/render/, src/debug.ts
  server/     The authoritative Colyseus server: one world room (5 seats, joined by id) that owns the only live sim,
              steps it at TICK_RATE and sends world-state deltas. src/world/ holds the room, the seats, the inbound gate and the boot.
docs/decisions/   Architecture decision records (ADRs). Read 0001, 0002 and 0003 before touching core or levels, 0004 before touching replication or networking.
verifications/    One folder per ticket with its verification scripts and proof.
```

Dependency versions live in one place: the `catalog` in `pnpm-workspace.yaml`. Packages reference them as `"catalog:"`.

**Architecture rules (non-negotiable)**

1. The sim is the single source of truth. The client is a view; it never decides anything about the game.
2. Input reaches the sim only as serializable commands (`Command` in `sim/src/core/commands.ts`). No callbacks, no direct mutation of sim state from outside the sim. Views and servers only ever hold a `SimHandle` (`step`, `snapshot`, read-only fields); the `Sim` class with components, physics and rng is internal to `packages/sim`.
3. State is serializable. `sim.snapshot()` must keep capturing everything: never keep game state outside components, the physics world and the rng.
4. The sim advances only through `step(commands)`, one fixed tick of `FIXED_DT` at a time. The client turns real time into whole ticks with `takeWholeTicks` (`client/src/loop/takeWholeTicks.ts`) and carries the leftover to the next frame; commands wait in a buffer until the next earned tick. Nothing else may call `step`.
5. Determinism: same seed + same commands = identical state. In `packages/sim` there is no `Math.random`, `Date`, `crypto`, timers, Node modules or I/O. Randomness goes through `sim.rng`. Lint enforces this.
6. Components hold numeric, mutable, per-entity state only (typed arrays). Static or rich data (names, sprites, stats, effects, speeds) lives in definition files keyed by a numeric `defId`; entities reference it through the `DefRef` component. See `docs/decisions/0001-ecs.md`.
7. Content is data: entities, levels and tuning values live in data files (`sim/src/content/`, `features/<feature>/defs.ts`), not in logic.
8. Physics lives in the sim. The client never imports Rapier or bitECS. The client reads the sim through `getRenderables(sim)` and other exports of `@novaland/sim`.
9. Package boundaries are enforced by lint (`eslint.config.js`) and by the sim's `tsconfig` (no DOM lib, no Node types). `sim` imports nothing from `client` or `server`; `client` and `server` import `@novaland/sim` through its package entry only, never deep paths.
10. Feature-oriented folders. New behaviour goes in `sim/src/features/<feature>/`; parallel agents should rarely touch the same files. The shared files a feature may touch, one line each: `features/index.ts` (register), `content/defs.ts` (spread in the feature's defs and claim an id block), `core/commands.ts` (add the command union), `src/index.ts` (expose something to views), `content/levels/*` (place content in a level).
11. Command handlers are the validation boundary. Commands will come from the network: validate every field, ignore what is malformed, never throw. `Sim.step` already drops values that are not objects with a string `type`.

**Naming**

- Name things by what the caller gets, not by how it works inside. The test: the call site must read as a plain sentence without opening the function. `const { ticks, leftover } = takeWholeTicks(...)` passes. `const { ticks, accumulator } = advanceFixedStep(...)` failed, because "advance" and "accumulator" describe the technique and you had to read the body to learn it returns a count.
- The same rule applies to result fields and to state. Store the leftover frame time as `leftover`, not under the name of the pattern it belongs to.
- If you cannot name a function by its result, it is probably doing two things. Split it, then name each half.
- Spell names out: `pendingCommands`, not `pending`; `renderable`, not `r`; `translation`, not `t`. A name must say what the value is without the reader looking at where it came from. The domain terms this file defines are the only short forms: `sim`, `eid` (entity id), `dt` (tick length in seconds), `rng`, `def`.
- Commands are named `'<feature>/<verb>'` and features by their domain noun (`player`, `terrain`), never by the ticket or the agent that made them.

**Functions and exports**

- A function with four or more arguments takes an options object with named fields instead: `takeWholeTicks({ leftover, deltaSeconds, dt, maxFrameSeconds })`, `attachStaticBox(sim, eid, { x, y, halfWidth, halfHeight })`. A leading subject such as `sim` or `eid` may stay positional.
- Anything exported only so tests can reach it goes through a single `export const __testing__ = { ... }` at the bottom of the module, never as a loose export. Lint rejects `import { __testing__ }` outside `*.test.ts`. The public surface of a module is what remains.

**Commands**

```
pnpm install
pnpm dev          # client dev server. PORT=5180 pnpm dev to pin a port (needed when several worktrees run at once)
pnpm test         # all tests in all packages, headless
pnpm typecheck    # tsc for every package
pnpm lint         # eslint, including the boundary rules
pnpm check        # test + typecheck + lint, what CI runs
pnpm sim:headless # runs the sim in the server package for 5 simulated seconds and prints a state hash
PORT=<n> pnpm --filter @novaland/server dev   # the world room server (default port 2567); clients join room id `world`
```

Before opening a PR: `pnpm install && pnpm test && pnpm typecheck && pnpm lint` must pass.

**How to add a feature without breaking the rules**

Example: a `coins` feature where players pick up coins.

1. Create `packages/sim/src/features/coins/`.
2. `components.ts`: declare components with `defineComponent(name, capacity => ({ field: f64(capacity) }))`. Numbers only. Names are unique across the whole sim (they key the snapshot; a duplicate throws). Read them in systems through `sim.store(Component)`.
3. `defs.ts`: export `CoinDefId` and `coinDefs: readonly EntityDef[]`. Claim the next free block of 100 ids in the comment at the top of `content/defs.ts` and spread your list into `entityDefs` and `DefId` there. A coin that is just "another kind of pickup" is only a new entry in `coinDefs`. Ids are forever: never reuse or renumber.
4. `commands.ts` (only if players can do something new): declare command interfaces with a `type` literal named `'<feature>/<verb>'` (for example `'coins/drop'`) and plain JSON fields. Add the union to `Command` in `core/commands.ts`. Validate every field in the handler and ignore bad input.
5. `index.ts`: export a `Feature` object (`core/feature.ts`) with `init` (spawn what the level or the feature's defs say exists at start), `handleCommand`, `update` (before the physics step) and/or `postStep`. Spawn entities with `sim.createEntity()` after checking `sim.isFull`; attach bodies with the helpers in `core/physics.ts`; remove entities with `sim.destroyEntity(eid)`.
6. Register it in `features/index.ts`. Order matters only if your feature depends on another feature's work within the same tick.
7. Tests next to the code (`*.test.ts`): create a sim with `__testing__.createSimInternal` from `core/create.ts` (full access) or `createSim` (handle only), drive `sim.step(commands)` for N ticks, assert on `sim.snapshot()` or `getRenderables(sim)`. Every feature needs at least one headless test that proves it works, and nothing you add may break `core/determinism.test.ts`.
8. If a view needs something new, export it from `sim/src/index.ts` and consume it in `packages/client`. The client only draws; if you are tempted to put an `if` about game rules in the client, it belongs in the sim.
9. Level content goes in `sim/src/content/levels/`. A level is ASCII rows plus a legend from characters to tile defs (`features/terrain/defs.ts`); one character is one tile, one metre, and the `spawn` is a tile coordinate. Solid tiles (trees, rocks) become colliders in the sim and the client draws every tile from the same rows, so placing an obstacle is typing a character. A new kind of tile is a new `TileDef` with a `solid` flag and a placeholder colour. Levels describe terrain only for now: a feature that needs its own things placed in a level (coins, doors) adds an optional field to `LevelData` for them, one line in `content/levels/types.ts`, and reads it in its `init`. See `docs/decisions/0003-levels-as-tiles.md`. Tuning numbers that are global go in `content/tuning.ts`; feature-specific ones go in the feature's `defs.ts`.
10. Run `pnpm check`. Lint will tell you if you crossed a boundary.

**Verifying work**

- Agents verify headlessly: sim tests are the proof that a feature works. The browser is for humans.
- Test files read top-down: imports, then the `describe` blocks, then fixtures, fakes and helper functions at the bottom under a `// ---- Helpers ----` comment. A reader should see what is being asserted before how it is set up. Function declarations hoist, so this is always safe for them; `const` helpers and fixtures are fine too as long as they are only used inside `it`, `beforeAll` and similar callbacks, never in a `describe` body.
- For user-facing changes, the ticket's `verifications/<ticket>/` folder holds scripts that exercise the real app (for example Playwright against `pnpm dev`) and the proof they produced (screenshots, logs, JSON reports). See `verifications/1-bootstrap-monorepo/` for the template.
- Dev builds expose `window.__novaland` (`sim`, `game`, `snapshot()`, `hash()`, `level`, `grid`, `tileAt`, `tileCentre`, `defs`, `pixelsPerMetre`, `minVisibleMetres`, `camera()`) so browser checks can read sim state and derive expectations from content instead of hardcoding numbers. It is stripped from production builds.
- Units: the sim works in metres, origin at the level centre, y pointing down; one tile is `TILE_SIZE` metres and `tileCentre`/`tileAt` (exported by the sim) convert between tiles and metres. One metre is one 16-pixel tile: the client converts metres to pixels with `PIXELS_PER_METRE` in `client/src/render/units.ts`. On-screen size comes from the camera's whole-number zoom (`client/src/render/zoom.ts`), never from that ratio.

**Worktrees and ports**

- Every ticket is worked on in its own git worktree under `.worktrees/` (gitignored) on a branch with the same name. Each worktree needs its own `pnpm install`.
- Nothing hardcodes a port. `PORT=<n> pnpm dev` pins the dev server (and fails if `<n>` is busy); unset, Vite picks a free one starting at 5173. Only the shell environment counts: `.env` files are not read for this.
- `.claude/launch.json` lets the desktop app preview the client from the main checkout; it lists 5173 as the port to open. Worktrees are previewed by starting `PORT=<n> pnpm dev` and opening that URL.
- Pick a port for the ticket that no other session is likely to use (for example `5100 + ticketNumber`), start the server in the background so it outlives the command, and mention the exact `PORT=<n> pnpm dev` line in the final message so the human can restart it in their own terminal. If they do, stop yours first: a pinned port refuses to start twice.

**Decisions**

Significant architectural choices are recorded in `docs/decisions/` as numbered ADRs. Add a new one when you make a choice the next agent would otherwise have to rediscover; never edit an accepted one, supersede it.
