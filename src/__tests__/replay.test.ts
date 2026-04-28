import { describe, expect, it } from 'vitest';
import { enforceTimestampTolerance } from '../core/replay.js';
import { WebhookError } from '../errors/index.js';

describe('enforceTimestampTolerance', () => {
  it('should return null when timestamp is null (provider without timestamp signing)', () => {
    expect(enforceTimestampTolerance(null, Date.now(), 300, 'github')).toBeNull();
  });

  it('should return null when toleranceSeconds is Infinity', () => {
    expect(enforceTimestampTolerance(0, Date.now(), Infinity, 'stripe')).toBeNull();
  });

  it('should return TIMESTAMP_INVALID when timestamp is non-finite', () => {
    const err = enforceTimestampTolerance(NaN, 1_700_000_000_000, 300, 'stripe');
    expect(err).toBeInstanceOf(WebhookError);
    expect(err?.code).toBe('TIMESTAMP_INVALID');
    expect(err?.providerId).toBe('stripe');
  });

  it('should return null when timestamp is exactly within tolerance', () => {
    const now = 1_700_000_000_000;
    const ts = now - 300_000; // exactly 300s
    expect(enforceTimestampTolerance(ts, now, 300, 'stripe')).toBeNull();
  });

  it('should return REPLAY_WINDOW_EXCEEDED when timestamp is too old', () => {
    const now = 1_700_000_000_000;
    const ts = now - 301_000; // 301s old
    const err = enforceTimestampTolerance(ts, now, 300, 'stripe');
    expect(err?.code).toBe('REPLAY_WINDOW_EXCEEDED');
    expect(err?.httpStatus).toBe(400);
    expect(err?.meta['skewMs']).toBe(301_000);
    expect(err?.meta['toleranceSeconds']).toBe(300);
  });

  it('should return REPLAY_WINDOW_EXCEEDED when timestamp is too far in the future', () => {
    const now = 1_700_000_000_000;
    const ts = now + 301_000; // 301s in future
    const err = enforceTimestampTolerance(ts, now, 300, 'stripe');
    expect(err?.code).toBe('REPLAY_WINDOW_EXCEEDED');
  });

  it('should treat the skew window symmetrically (Math.abs)', () => {
    const now = 1_700_000_000_000;
    expect(enforceTimestampTolerance(now + 200_000, now, 300, 'x')).toBeNull();
    expect(enforceTimestampTolerance(now - 200_000, now, 300, 'x')).toBeNull();
  });
});
