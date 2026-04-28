import { WebhookError } from '../errors/index.js';

/**
 * Enforce the timestamp tolerance window. Returns a `WebhookError` to
 * carry through the result-style flow rather than throwing.
 *
 * Both past-skewed (`now - ts > tolerance`) and future-skewed
 * (`ts - now > tolerance`) drifts trigger a rejection. Future-skew is
 * not free: a clock-ahead provider could be a tampering signal, and the
 * replay window must be symmetric to be meaningful.
 *
 * @param timestampMs       Provider-asserted timestamp in epoch ms (or `null` if the provider doesn't sign one).
 * @param nowMs             Current time in epoch ms; usually `clock.now()`.
 * @param toleranceSeconds  Allowed skew on either side. Pass `Infinity` to disable.
 * @param providerId        For error metadata.
 * @returns `null` if the timestamp is acceptable, a `WebhookError` otherwise.
 */
export function enforceTimestampTolerance(
  timestampMs: number | null,
  nowMs: number,
  toleranceSeconds: number,
  providerId: string,
): WebhookError | null {
  if (timestampMs === null) return null; // Provider doesn't sign a timestamp.
  if (toleranceSeconds === Infinity) return null;
  if (!Number.isFinite(timestampMs)) {
    return new WebhookError({
      code: 'TIMESTAMP_INVALID',
      message: 'Provider timestamp is not a finite number',
      httpStatus: 400,
      providerId,
    });
  }
  const skewMs = Math.abs(nowMs - timestampMs);
  const toleranceMs = toleranceSeconds * 1000;
  if (skewMs > toleranceMs) {
    return new WebhookError({
      code: 'REPLAY_WINDOW_EXCEEDED',
      message: `Timestamp outside tolerance window of ${String(toleranceSeconds)}s`,
      httpStatus: 400,
      providerId,
      meta: { skewMs, toleranceSeconds },
    });
  }
  return null;
}
