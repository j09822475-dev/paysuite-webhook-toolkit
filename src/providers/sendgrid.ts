import { base64, utf8 } from '../core/encoding.js';
import { normalizeEd25519PublicKey, verifyEd25519 } from '../core/crypto.js';
import type { WebhookProvider } from '../core/types.js';

/** SendGrid event-webhook payload. Top-level array of event objects. */
export type SendGridEvent = ReadonlyArray<Record<string, unknown>>;

/**
 * SendGrid webhook provider. Uses Ed25519 over `${timestamp}${rawBody}`.
 *
 * The "secret" passed to `createVerifier` here is SendGrid's verification
 * **public key** — supports raw 32-byte hex/base64, or PEM-wrapped DER.
 *
 * @example
 * ```ts
 * import { sendgrid } from '@paysuite/webhook-toolkit/providers/sendgrid';
 * createVerifier({ provider: sendgrid, secret: process.env.SENDGRID_PUBLIC_KEY! });
 * ```
 */
export const sendgrid: WebhookProvider<SendGridEvent> = {
  id: 'sendgrid',
  algorithm: 'Ed25519',

  parseSignature: (headers) => {
    const raw = headers.get('x-twilio-email-event-webhook-signature');
    if (!raw) return null;
    return { signatures: [base64.decode(raw.trim())], raw };
  },

  extractTimestamp: (headers) => {
    const v = headers.get('x-twilio-email-event-webhook-timestamp');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n * 1000 : null;
  },

  verify: async ({ signature, secret, rawBody, timestamp }) => {
    const publicKey = normalizeEd25519PublicKey(secret);
    const seconds = Math.floor((timestamp ?? 0) / 1000);
    const tsBytes = utf8.encode(String(seconds));
    const data = new Uint8Array(tsBytes.length + rawBody.length);
    data.set(tsBytes, 0);
    data.set(rawBody, tsBytes.length);
    return verifyEd25519(publicKey, signature, data);
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as SendGridEvent,
};
