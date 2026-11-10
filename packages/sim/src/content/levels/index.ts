import { starterLevel } from './starter';
import type { LevelData } from './types';

/**
 * Every level the game knows, by the name a snapshot or a server's welcome
 * message carries. Add a level by adding one line here.
 */
export const levels: readonly LevelData[] = [starterLevel];

const levelByName: ReadonlyMap<string, LevelData> = new Map(levels.map((level) => [level.name, level]));

if (levelByName.size !== levels.length) {
  throw new Error('levels contains duplicate names');
}

/** The level with this name, or undefined. For names that came from outside the process (a welcome message, a save file). */
export function findLevel(name: string): LevelData | undefined {
  return levelByName.get(name);
}
