import type { WebhookProvider } from '../core/types.js';
import { simpleHmacProvider } from './_shared/hmac-provider.js';

/** Lemon Squeezy webhook event payload. */
export type LemonSqueezyEvent = {
  readonly meta?: { readonly event_name?: string };
  readonly data?: Record<string, unknown>;
  readonly [k: string]: unknown;
};

/**
 * Lemon Squeezy webhook provider. Header `X-Signature` carries an
 * HMAC-SHA256 hex digest of the raw body.
 *
 * @example
 * ```ts
 * import { lemonSqueezy } from '@paysuite/webhook-toolkit/providers/lemon-squeezy';
 * createVerifier({ provider: lemonSqueezy, secret: process.env.LEMON_SECRET! });
 * ```
 */
export const lemonSqueezy: WebhookProvider<LemonSqueezyEvent> = simpleHmacProvider<LemonSqueezyEvent>({
  id: 'lemon-squeezy',
  algorithm: 'HMAC-SHA256',
  signatureHeader: 'x-signature',
  signatureEncoding: 'hex',
  idempotencyKey: (input) => input.headers.get('x-event-id'),
});
