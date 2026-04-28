import type { WebhookProvider } from '../core/types.js';
import { simpleHmacProvider } from './_shared/hmac-provider.js';

/** Linear webhook event payload. */
export type LinearEvent = {
  readonly action?: string;
  readonly type?: string;
  readonly [k: string]: unknown;
};

/**
 * Linear webhook provider. Header `Linear-Signature` carries an HMAC-
 * SHA256 hex digest of the raw body; idempotency key from `delivery`
 * field.
 *
 * @example
 * ```ts
 * import { linear } from '@paysuite/webhook-toolkit/providers/linear';
 * createVerifier({ provider: linear, secret: process.env.LINEAR_WEBHOOK_SECRET! });
 * ```
 */
export const linear: WebhookProvider<LinearEvent> = simpleHmacProvider<LinearEvent>({
  id: 'linear',
  algorithm: 'HMAC-SHA256',
  signatureHeader: 'linear-signature',
  signatureEncoding: 'hex',
  idempotencyKey: (input, event) =>
    input.headers.get('linear-delivery') ?? (typeof event['delivery'] === 'string' ? (event['delivery'] as string) : null),
});
