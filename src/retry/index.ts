import type { HeaderBag } from '../core/types.js';

/**
 * Provider-agnostic retry metadata extracted from request headers.
 *
 * Each field is best-effort: providers expose different combinations.
 * `attempt` is 1-based when known.
 */
export interface RetryMetadata {
  /** True if the provider's headers indicate this delivery is a retry. */
  readonly isRetry: boolean;
  /** Attempt number (1-based) if the provider exposes it. */
  readonly attempt: number | null;
  /** Stable delivery / message id (also useful for idempotency). */
  readonly deliveryId: string | null;
}

/**
 * Normalize per-provider retry signals into a common shape.
 *
 * Recognized headers:
 * - Stripe:  no header (must be derived from `event.created` / first delivery
 *            timestamp by the user); we surface the absence rather than guess.
 * - GitHub:  `X-GitHub-Hook-ID` + `X-GitHub-Delivery`. GitHub does not expose
 *            an attempt counter — `isRetry` is `null` from the headers alone.
 * - Svix / Standard Webhooks: `webhook-id` + `svix-num-retries` (when present).
 * - Shopify: `X-Shopify-Webhook-Id` + `X-Shopify-Delivery-Id`.
 *
 * @param providerId - Provider identifier.
 * @param headers    - Request headers (case-insensitive).
 * @returns Normalized {@link RetryMetadata}.
 *
 * @example
 * ```ts
 * import { extractRetryMetadata } from '@paysuite/webhook-toolkit/retry';
 * const meta = extractRetryMetadata('svix', headers);
 * if (meta.isRetry) log.warn('retry delivery', meta);
 * ```
 */
export function extractRetryMetadata(providerId: string, headers: HeaderBag): RetryMetadata {
  switch (providerId) {
    case 'github':
      return {
        isRetry: headers.has('x-github-hook-id') && headers.has('x-github-delivery'),
        attempt: null,
        deliveryId: headers.get('x-github-delivery'),
      };
    case 'svix':
    case 'clerk':
    case 'resend': {
      const attemptStr = headers.get('svix-num-retries') ?? headers.get('webhook-attempt');
      const attempt = attemptStr ? Number(attemptStr) : NaN;
      return {
        isRetry: Number.isFinite(attempt) && attempt > 0,
        attempt: Number.isFinite(attempt) ? attempt + 1 : null,
        deliveryId: headers.get('webhook-id'),
      };
    }
    case 'shopify':
      return {
        isRetry: false, // Shopify does not expose a retry flag.
        attempt: null,
        deliveryId: headers.get('x-shopify-webhook-id') ?? headers.get('x-shopify-delivery-id'),
      };
    case 'stripe':
      return {
        isRetry: false,
        attempt: null,
        deliveryId: null,
      };
    default:
      return {
        isRetry: false,
        attempt: null,
        deliveryId: headers.get('webhook-id') ?? headers.get('x-request-id'),
      };
  }
}
