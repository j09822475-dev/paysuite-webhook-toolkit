import { hmacSha256 } from '../core/crypto.js';
import { hex, utf8 } from '../core/encoding.js';
import { timingSafeEqual } from '../core/timing-safe.js';
import type { WebhookProvider } from '../core/types.js';

/** Mailgun webhook event payload (`event-data` shape). */
export type MailgunEvent = {
  readonly signature?: { readonly token?: string; readonly timestamp?: string; readonly signature?: string };
  readonly 'event-data'?: { readonly id?: string; readonly event?: string; readonly [k: string]: unknown };
  readonly [k: string]: unknown;
};

interface MailgunSig {
  readonly token: string;
  readonly timestamp: number;
  readonly signature: string;
}

function parseMailgunSig(rawBody: Uint8Array): MailgunSig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.decode(rawBody)) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const sig = (parsed as { signature?: unknown }).signature;
  if (!sig || typeof sig !== 'object') return null;
  const s = sig as { token?: unknown; timestamp?: unknown; signature?: unknown };
  if (typeof s.token !== 'string' || typeof s.signature !== 'string') return null;
  const ts = typeof s.timestamp === 'string' ? Number(s.timestamp) : typeof s.timestamp === 'number' ? s.timestamp : NaN;
  if (!Number.isFinite(ts)) return null;
  return { token: s.token, timestamp: ts, signature: s.signature };
}

/**
 * Mailgun webhook provider.
 *
 * Mailgun signs `${timestamp}${token}` with HMAC-SHA256, returning the
 * hex digest in the `signature` field of the JSON body itself (not in
 * a header). Idempotency uses `signature.token`.
 *
 * @example
 * ```ts
 * import { mailgun } from '@paysuite/webhook-toolkit/providers/mailgun';
 * createVerifier({ provider: mailgun, secret: process.env.MAILGUN_SIGNING_KEY! });
 * ```
 */
export const mailgun: WebhookProvider<MailgunEvent> = {
  id: 'mailgun',
  algorithm: 'HMAC-SHA256',

  parseSignature: (_headers) => {
    // Signature lives in the body for Mailgun; `parseSignature` is
    // just used to short-circuit when nothing is present. The actual
    // body-derived signature is read by `buildSigningString` below.
    return { signatures: [new Uint8Array(0)], raw: '<in-body>' };
  },

  extractTimestamp: (_headers, rawBody) => {
    const sig = parseMailgunSig(rawBody);
    return sig ? sig.timestamp * 1000 : null;
  },

  // The signature lives in the body for Mailgun — `parseSignature` cannot
  // return it directly, so this provider uses the `verify` escape hatch.
  verify: async ({ secret, rawBody, timestamp }) => {
    const sig = parseMailgunSig(rawBody);
    if (!sig) return false;
    const seconds = Math.floor((timestamp ?? sig.timestamp * 1000) / 1000);
    const expected = await hmacSha256(secret, utf8.encode(`${String(seconds)}${sig.token}`));
    let actual: Uint8Array;
    try {
      actual = hex.decode(sig.signature);
    } catch {
      return false;
    }
    return timingSafeEqual(actual, expected);
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as MailgunEvent,

  idempotencyKey: (_input, event) => event.signature?.token ?? null,
};
