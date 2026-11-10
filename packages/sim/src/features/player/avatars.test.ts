import { describe, expect, it } from 'vitest';
import { getDef } from '../../content/defs';
import type { Command } from '../../core/commands';
import { __testing__ } from '../../core/create';
import type { Sim } from '../../core/sim';
import { avatarDefIds, isAvatarDefId } from './defs';
import { findPlayerEntity } from './queries';

describe('avatars on join (headless)', () => {
  it('dresses every joining player in one of the avatar defs, which all share speed, radius and a sprite sheet of their own', async () => {
    const sim = await createSimInternal({ seed: 7 });
    sim.step([join(0), join(1), join(2)]);
    for (const slot of [0, 1, 2]) {
      const defId = avatarOf(sim, slot);
      expect(isAvatarDefId(defId)).toBe(true);
      expect(getDef(defId).speed).toBe(getDef(avatarDefIds[0] as number).speed);
      expect(getDef(defId).radius).toBe(getDef(avatarDefIds[0] as number).radius);
    }
    const sheetKeys = avatarDefIds.map((defId) => getDef(defId).sprite?.key);
    expect(new Set(sheetKeys).size).toBe(avatarDefIds.length);
    expect(sheetKeys.every((key) => typeof key === 'string' && key.length > 0)).toBe(true);
    sim.destroy();
  });

  it('picks the same avatars for the same seed and the same joins, and other avatars for another seed', async () => {
    const first = await avatarsAfterJoins(42, 5);
    const again = await avatarsAfterJoins(42, 5);
    expect(again).toEqual(first);
    const sequences = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) sequences.add((await avatarsAfterJoins(seed, 5)).join(','));
    expect(sequences.size).toBeGreaterThan(1);
  });

  it('never hands out an avatar somebody present wears while an unworn one is left', async () => {
    const sim = await createSimInternal({ seed: 3 });
    const slots = avatarDefIds.map((_, index) => index);
    sim.step(slots.map((slot) => join(slot)));
    const worn = slots.map((slot) => avatarOf(sim, slot));
    expect(new Set(worn).size).toBe(avatarDefIds.length);
    expect([...worn].sort((a, b) => a - b)).toEqual([...avatarDefIds]);
    sim.destroy();
  });

  it('falls back to a worn avatar once every one is taken, instead of refusing the join', async () => {
    const sim = await createSimInternal({ seed: 3 });
    const slots = avatarDefIds.map((_, index) => index);
    sim.step(slots.map((slot) => join(slot)));
    const extraSlot = avatarDefIds.length;
    sim.step([join(extraSlot)]);
    expect(findPlayerEntity(sim, extraSlot)).toBeDefined();
    expect(isAvatarDefId(avatarOf(sim, extraSlot))).toBe(true);
    sim.destroy();
  });

  it('frees an avatar when its player leaves, so the next arrival takes the only unworn one', async () => {
    const sim = await createSimInternal({ seed: 11 });
    const slots = avatarDefIds.map((_, index) => index);
    sim.step(slots.map((slot) => join(slot)));
    const freed = avatarOf(sim, 2);
    sim.step([{ type: 'player/leave', slot: 2 }]);
    sim.step([join(avatarDefIds.length)]);
    expect(avatarOf(sim, avatarDefIds.length)).toBe(freed);
    sim.destroy();
  });

  it('ignores any avatar a client puts in the join command: the sim chooses', async () => {
    const plain = await createSimInternal({ seed: 5 });
    plain.step([join(0)]);
    const chosenByTheSim = avatarOf(plain, 0);
    const otherAvatar = avatarDefIds.find((defId) => defId !== chosenByTheSim) as number;
    plain.destroy();

    const withWishes = await createSimInternal({ seed: 5 });
    const wishes = [
      { type: 'player/join', slot: 0, defId: otherAvatar },
      { type: 'player/join', slot: 1, avatar: otherAvatar, x: 0, y: 0 },
    ] as unknown as Command[];
    withWishes.step(wishes);
    expect(avatarOf(withWishes, 0)).toBe(chosenByTheSim);
    expect(isAvatarDefId(avatarOf(withWishes, 1))).toBe(true);
    withWishes.destroy();
  });

  it('keeps the avatar in the snapshot through the DefRef component, so it survives serialization', async () => {
    const sim = await createSimInternal({ seed: 9 });
    sim.step([join(0)]);
    const player = sim.snapshot().entities.find((entity) => entity.components['Player']);
    expect(player?.components['DefRef']?.['id']).toBe(avatarOf(sim, 0));
    sim.destroy();
  });
});

// ---- Helpers (below the tests so the behaviour reads first) ----

const { createSimInternal } = __testing__;

const join = (slot: number): Command => ({ type: 'player/join', slot });

function avatarOf(sim: Sim, slot: number): number {
  const eid = findPlayerEntity(sim, slot);
  if (eid === undefined) throw new Error(`no player in slot ${slot}`);
  const player = sim.snapshot().entities.find((entity) => entity.id === eid);
  return player?.components['DefRef']?.['id'] as number;
}

async function avatarsAfterJoins(seed: number, players: number): Promise<number[]> {
  const sim = await createSimInternal({ seed });
  for (let slot = 0; slot < players; slot += 1) sim.step([join(slot)]);
  const avatars = Array.from({ length: players }, (_, slot) => avatarOf(sim, slot));
  sim.destroy();
  return avatars;
}
