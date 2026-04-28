import type { Clock } from './types.js';

/**
 * Default clock backed by `Date.now()`. Pure side-effect-free wrapper so
 * tests can substitute a {@link Clock} that returns a fixed timestamp.
 */
export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};
