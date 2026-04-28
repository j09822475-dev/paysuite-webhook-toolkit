import { WebhookError } from '../errors/index.js';
import type {
  EventOf,
  Metrics,
  VerificationResult,
  Verifier,
  VerifierInput,
  WebhookProvider,
} from '../core/types.js';
import type { IdempotencyStore } from './types.js';

export { memoryStore, type MemoryStoreOptions } from './memory.js';
export type { IdempotencyStore, IdempotencyRecord } from './types.js';

/** Behavior when an idempotency key has already been seen. */
export type OnDuplicate = 'skip' | 'replay-cached' | 'error';

/** Options for {@link withIdempotency}. */
export interface IdempotencyOptions {
  /** Pluggable storage backend (memory / Redis / KV / D1 / Upstash / DynamoDB). */
  readonly store: IdempotencyStore;
  /** Time-to-live for stored keys, in seconds. Default `86_400` (24 h). */
  readonly ttlSeconds?: number;
  /**
   * What to do on duplicate.
   *
   * - `'skip'` (**default**) — return a `WebhookError(IDEMPOTENCY_DUPLICATE)`
   *   with `httpStatus: 200`. Adapters ack with 200 so the provider stops
   *   retrying. The handler is NOT invoked.
   * - `'replay-cached'` — return the cached response body (requires
   *   `saveResult`/`getResult` on the store), `httpStatus: 200`.
   * - `'error'` — return `IDEMPOTENCY_DUPLICATE` with `httpStatus: 409`.
   *   Use only when duplicates indicate a programmer bug to surface.
   */
  readonly onDuplicate?: OnDuplicate;
  /** Optional metrics sink for `idempotency.duplicate` / `idempotency.store_error`. */
  readonly metrics?: Metrics;
}

const DEFAULT_TTL_SECONDS = 86_400;

/**
 * Wrap a {@link Verifier} so previously-seen webhook IDs are not
 * processed twice. Composition-friendly — returns another `Verifier`
 * with the same provider type.
 *
 * @typeParam P  - Provider type carried through unchanged.
 * @param verifier - The wrapped verifier.
 * @param options  - Idempotency configuration (store / TTL / onDuplicate).
 * @returns A `Verifier` whose `.verify(input)` short-circuits on duplicate keys.
 *
 * @example
 * ```ts
 * import { createVerifier } from '@paysuite/webhook-toolkit';
 * import { withIdempotency, memoryStore } from '@paysuite/webhook-toolkit/idempotency';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const base = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });
 * const verifier = withIdempotency(base, { store: memoryStore(), ttlSeconds: 86_400 });
 * ```
 */
export function withIdempotency<P extends WebhookProvider>(
  verifier: Verifier<P>,
  options: IdempotencyOptions,
): Verifier<P> {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const mode: OnDuplicate = options.onDuplicate ?? 'skip';
  const metrics = options.metrics;

  const verify = async (input: VerifierInput): Promise<VerificationResult<EventOf<P>>> => {
    const inner = await verifier.verify(input);
    if (!inner.ok) return inner;

    if (inner.idempotencyKey === null) return inner;

    let inserted: boolean;
    try {
      inserted = await options.store.putIfAbsent(inner.idempotencyKey, ttl);
    } catch (cause) {
      metrics?.increment('idempotency.store_error', { providerId: verifier.providerId });
      const err = new WebhookError({
        code: 'IDEMPOTENCY_STORE',
        message: 'Idempotency store is unavailable',
        httpStatus: 503,
        providerId: verifier.providerId,
        cause,
      });
      return { ok: false, error: err };
    }

    if (inserted) return inner;

    metrics?.increment('idempotency.duplicate', { providerId: verifier.providerId });
    const httpStatus = mode === 'error' ? 409 : 200;
    const message =
      mode === 'replay-cached'
        ? 'Duplicate webhook delivery; replaying cached result'
        : 'Duplicate webhook delivery';
    const err = new WebhookError({
      code: 'IDEMPOTENCY_DUPLICATE',
      message,
      httpStatus,
      providerId: verifier.providerId,
      meta: { idempotencyKey: inner.idempotencyKey, mode },
    });
    return { ok: false, error: err };
  };

  return {
    providerId: verifier.providerId,
    verify,
  };
}
