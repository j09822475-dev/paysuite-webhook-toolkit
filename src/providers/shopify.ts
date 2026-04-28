import { base64, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Shopify webhook event body (loose generic shape). */
export type ShopifyEvent = { readonly [k: string]: unknown };

/**
 * Shopify webhook provider.
 *
 * Header: `X-Shopify-Hmac-Sha256: <base64>`. Signs the raw body. No
 * timestamp signed; idempotency uses `X-Shopify-Webhook-Id`.
 *
 * @example
 * ```ts
 * import { shopify } from '@paysuite/webhook-toolkit/providers/shopify';
 * createVerifier({ provider: shopify, secret: process.env.SHOPIFY_WEBHOOK_SECRET! });
 * ```
 */
export const shopify: WebhookProvider<ShopifyEvent> = {
  id: 'shopify',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('x-shopify-hmac-sha256');
    if (!raw) return null;
    return { signatures: [base64.decode(raw.trim())], raw };
  },

  extractTimestamp: () => null,

  buildSigningString: ({ rawBody }) => rawBody,

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as ShopifyEvent,

  idempotencyKey: (input) => input.headers.get('x-shopify-webhook-id'),
};
