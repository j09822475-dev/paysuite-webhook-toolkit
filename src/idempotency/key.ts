import type { HeaderBag } from '../core/types.js';

/**
 * Default provider-aware idempotency-key extractor. Tries the
 * conventional headers first; falls back to a generic `webhook-id`.
 *
 * Most provider plugins ship their own `idempotencyKey` callback, so
 * this helper is mainly useful for custom providers.
 *
 * @param providerId - Provider identifier.
 * @param headers    - Request headers.
 * @returns The raw key (caller must namespace), or `null` if none found.
 */
export function defaultIdempotencyKey(providerId: string, headers: HeaderBag): string | null {
  switch (providerId) {
    case 'stripe':
      return null; // Stripe ships event.id; provider plugin extracts from body.
    case 'github':
      return headers.get('x-github-delivery');
    case 'shopify':
      return headers.get('x-shopify-webhook-id');
    case 'lemon-squeezy':
      return headers.get('x-event-id');
    case 'vercel':
      return headers.get('x-vercel-delivery');
    case 'svix':
    case 'clerk':
    case 'resend':
      return headers.get('webhook-id');
    default:
      return headers.get('webhook-id') ?? headers.get('x-request-id');
  }
}
