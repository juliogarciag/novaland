# @novaland/server

Placeholder for the authoritative multiplayer server. Not wired to anything yet.

## Plan (not implemented)

- A Colyseus `Room` per world instance. The room owns one `Sim` from `@novaland/sim`
  and steps it on a fixed timer at `TICK_RATE`.
- Clients send sim `Command`s (already serializable) tagged with their slot; the
  room validates the slot against the session and feeds them to `sim.step`.
- State goes out as snapshots or deltas derived from `sim.snapshot()`; the client
  renders them with the same view code it uses for a local sim.
- Because the sim is deterministic, lockstep (commands only) is also an option.

Until then, `pnpm sim:headless` runs the sim here for a few seconds and prints a
state hash, which proves the server package can drive the sim without a browser.
