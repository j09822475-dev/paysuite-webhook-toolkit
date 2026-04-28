import type { Clock } from '../core/types.js';

/** A test-only clock whose time is advanced manually. */
export interface FakeClock extends Clock {
  /** Advance the clock by `ms` milliseconds. */
  advance(ms: number): void;
  /** Set the clock to an absolute epoch-ms timestamp. */
  set(epochMs: number): void;
}

/**
 * Create a deterministic clock for tests. Starts at `epochMs` (default
 * `0`) and only advances when `.advance(ms)` or `.set(...)` is called.
 *
 * @param epochMs - Initial time in epoch ms.
 * @returns A {@link FakeClock}.
 *
 * @example
 * ```ts
 * import { fakeClock } from '@paysuite/webhook-toolkit/testing';
 * const clock = fakeClock(1_700_000_000_000);
 * createVerifier({ provider: stripe, secret, clock });
 * clock.advance(60_000);
 * ```
 */
export function fakeClock(epochMs = 0): FakeClock {
  let current = epochMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (value) => {
      current = value;
    },
  };
}
