import { base64, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Square webhook event payload. */
export type SquareEvent = {
  readonly event_id?: string;
  readonly type?: string;
  readonly [k: string]: unknown;
};

/**
 * Square webhook provider.
 *
 * Header: `x-square-hmacsha256-signature: <base64>`. Signing string is
 * the **notification URL** concatenated with the raw body. The
 * adapter / caller must populate `NormalizedRequest.url` with the
 * exact URL Square is calling — by default this is the request URL,
 * but if the service sits behind a proxy the user must provide it.
 *
 * @example
 * ```ts
 * import { square } from '@paysuite/webhook-toolkit/providers/square';
 * createVerifier({ provider: square, secret: process.env.SQUARE_SIGNATURE_KEY! });
 * ```
 */
export const square: WebhookProvider<SquareEvent> = {
  id: 'square',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('x-square-hmacsha256-signature');
    if (!raw) return null;
    return { signatures: [base64.decode(raw.trim())], raw };
  },

  extractTimestamp: () => null,

  buildSigningString: ({ rawBody, url }) => {
    const prefix = utf8.encode(url);
    const out = new Uint8Array(prefix.length + rawBody.length);
    out.set(prefix, 0);
    out.set(rawBody, prefix.length);
    return out;
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as SquareEvent,

  idempotencyKey: (_input, event) => event.event_id ?? null,
};
