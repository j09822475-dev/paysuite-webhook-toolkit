import { base64, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Twilio webhook event payload. Loose shape — Twilio uses form fields. */
export type TwilioEvent = {
  readonly MessageSid?: string;
  readonly AccountSid?: string;
  readonly [k: string]: unknown;
};

function parseFormBody(rawBody: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  if (rawBody.length === 0) return out;
  const text = utf8.decode(rawBody);
  for (const part of text.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out.set(k, v);
  }
  return out;
}

/**
 * Twilio webhook provider.
 *
 * Algorithm: HMAC-SHA1, base64-encoded. The signing string mixes the
 * full request URL with sorted form fields for `application/x-www-form-
 * urlencoded` requests. For JSON requests, Twilio appends a SHA-256 of
 * the body to the URL — out of scope for this default implementation;
 * users can override `buildSigningString` if needed.
 *
 * @example
 * ```ts
 * import { twilio } from '@paysuite/webhook-toolkit/providers/twilio';
 * createVerifier({ provider: twilio, secret: process.env.TWILIO_AUTH_TOKEN! });
 * ```
 */
export const twilio: WebhookProvider<TwilioEvent> = {
  id: 'twilio',
  algorithm: 'HMAC-SHA1',

  parseSignature: (headers) => {
    const raw = headers.get('x-twilio-signature');
    if (!raw) return null;
    return { signatures: [base64.decode(raw.trim())], raw };
  },

  extractTimestamp: () => null,

  buildSigningString: ({ rawBody, url }) => {
    const fields = parseFormBody(rawBody);
    const keys = [...fields.keys()].sort();
    let s = url;
    for (const k of keys) s += k + (fields.get(k) ?? '');
    return utf8.encode(s);
  },

  parseEvent: (rawBody) => {
    if (rawBody.length === 0) return {} as TwilioEvent;
    const text = utf8.decode(rawBody);
    if (text.trimStart().startsWith('{')) return JSON.parse(text) as TwilioEvent;
    const obj: Record<string, string> = {};
    for (const [k, v] of parseFormBody(rawBody)) obj[k] = v;
    return obj as TwilioEvent;
  },

  idempotencyKey: (_input, event) => event.MessageSid ?? null,
};
