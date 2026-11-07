import type { Sim, SimSnapshot } from '@novaland/sim';
import { hashSnapshot } from '@novaland/sim';
import type Phaser from 'phaser';

/** What dev tooling and end-to-end checks can reach from the page. Dev builds only. */
export interface NovalandDebugApi {
  readonly sim: Sim;
  readonly game: Phaser.Game;
  snapshot(): SimSnapshot;
  hash(): string;
}

declare global {
  interface Window {
    __novaland?: NovalandDebugApi;
  }
}

export function exposeDebugApi(sim: Sim, game: Phaser.Game): void {
  window.__novaland = {
    sim,
    game,
    snapshot: () => sim.snapshot(),
    hash: () => hashSnapshot(sim.snapshot()),
  };
}
