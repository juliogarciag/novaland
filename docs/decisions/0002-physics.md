# 0002 - Physics: Rapier deterministic build inside the sim

Status: accepted. Date: 2026-11-06.

## Context

Physics is game logic: where a body ends up after a tick is state every client must agree on. It therefore belongs to `packages/sim`, which cannot depend on Phaser. We also want the same commands to produce the same bytes everywhere, for lockstep networking, replays and desync detection.

## Decision

- Physics runs in the sim through **Rapier 2D**, package `@dimforge/rapier2d-deterministic-compat`:
  - `deterministic`: built with Rapier's enhanced-determinism flag, so results match across platforms, not only across runs on one machine.
  - `compat`: the WASM module is embedded, so it loads in Node (tests, server) and in Vite with no bundler configuration.
- The physics world is stepped once per sim tick at the fixed `FIXED_DT`. Nothing else ever steps it.
- Bodies are owned by Rapier; the ECS keeps the body handle in the `Body` component and the sim mirrors translations into `Position` after each step.
- Units are metres, origin at the level centre, **y pointing down** so that the view needs no axis flip. There is no gravity: this is a top-down world.
- Phaser Arcade and Matter physics are never used.

## Consequences

- `createSim` is async: the WASM module loads on first use.
- Snapshots include the Rapier world (`takeSnapshot`, base64); equality of snapshots is a strict determinism check.
- Restoring a snapshot into a live sim is not implemented yet (tracked as a follow-up ticket).
