import type { WebhookProvider } from '../core/types.js';
import { simpleHmacProvider } from './_shared/hmac-provider.js';

/** Vercel webhook event payload (top-level shape). */
export type VercelEvent = {
  readonly id?: string;
  readonly type?: string;
  readonly [k: string]: unknown;
};

/**
 * Vercel webhook provider. Header `x-vercel-signature` carries an HMAC-
 * SHA1 hex digest of the raw body.
 *
 * @example
 * ```ts
 * import { vercel } from '@paysuite/webhook-toolkit/providers/vercel';
 * createVerifier({ provider: vercel, secret: process.env.VERCEL_WEBHOOK_SECRET! });
 * ```
 */
export const vercel: WebhookProvider<VercelEvent> = simpleHmacProvider<VercelEvent>({
  id: 'vercel',
  algorithm: 'HMAC-SHA1',
  signatureHeader: 'x-vercel-signature',
  signatureEncoding: 'hex',
  idempotencyKey: (input) => input.headers.get('x-vercel-delivery'),
});
