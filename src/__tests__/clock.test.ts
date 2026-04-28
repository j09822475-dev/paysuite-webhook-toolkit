import { describe, expect, it } from 'vitest';
import { systemClock } from '../core/clock.js';

describe('systemClock', () => {
  it('should return a finite epoch-ms value when called', () => {
    const t = systemClock.now();
    expect(t).toBeTypeOf('number');
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('should produce non-decreasing values across rapid calls', () => {
    const a = systemClock.now();
    const b = systemClock.now();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
