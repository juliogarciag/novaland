import type { Feature } from '../core/feature';
import { playerFeature } from './player';
import { terrainFeature } from './terrain';

/**
 * Every feature the sim runs, in execution order. Register a new feature by
 * adding one line here. Order matters only between features that depend on
 * each other's work within a tick.
 */
export const features: readonly Feature[] = [terrainFeature, playerFeature];
