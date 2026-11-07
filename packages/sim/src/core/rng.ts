/**
 * Seeded pseudo-random generator (mulberry32). All randomness in the sim goes
 * through this so that the same seed and commands always produce the same
 * state. Math.random is forbidden by lint in packages/sim.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Current internal state, for snapshots. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(maxExclusive) {
      return Math.floor(this.next() * maxExclusive);
    },
    state() {
      return state;
    },
  };
}
