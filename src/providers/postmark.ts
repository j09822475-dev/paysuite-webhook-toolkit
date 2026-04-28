import { configError } from '../errors/index.js';
import { utf8 } from '../core/encoding.js';
import type { HeaderBag, WebhookProvider } from '../core/types.js';

/** Postmark inbound payload — generic shape. */
export type PostmarkEvent = {
  readonly MessageID?: string;
  readonly RecordType?: string;
  readonly [k: string]: unknown;
};

/**
 * Verify Postmark Basic-auth credentials against an incoming request.
 *
 * Postmark does not crypto-sign webhooks; instead the inbound URL is
 * configured with HTTP Basic Auth and Postmark replays the credentials
 * on every delivery. Use this helper alongside the regular framework
 * adapter — it is **not** a `Verifier` (no signature material to verify).
 *
 * @param input.headers - Request headers (any case-insensitive bag).
 * @param input.user    - Expected Basic-auth username.
 * @param input.pass    - Expected Basic-auth password.
 * @returns `true` iff the `Authorization` header carries matching Basic credentials.
 *
 * @example
 * ```ts
 * if (!verifyPostmarkBasicAuth({ headers, user, pass })) {
 *   return new Response('unauthorized', { status: 401 });
 * }
 * ```
 */
export function verifyPostmarkBasicAuth(input: {
  headers: HeaderBag;
  user: string;
  pass: string;
}): boolean {
  const auth = input.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  const expectedToken = btoaSafe(`${input.user}:${input.pass}`);
  return constantTimeStringEq(auth.slice('Basic '.length).trim(), expectedToken);
}

function btoaSafe(s: string): string {
  // `btoa` operates on Latin-1 strings; encode to UTF-8 bytes first.
  const bytes = utf8.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function'
    ? btoa(bin)
    : (() => {
        // Last-resort fallback. Both Node 18+ and modern edge runtimes
        // expose `btoa` globally, so this branch is essentially dead.
        throw configError('btoa is unavailable in this runtime');
      })();
}

function constantTimeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Postmark provider — present so the package surface is consistent, but
 * Postmark uses Basic auth instead of cryptographic signatures. The
 * `parseSignature` step always succeeds on a present `Authorization`
 * header; the real check happens in `verifyPostmarkBasicAuth`, which
 * users should call **before** invoking the verifier (or in `verify` via
 * a custom secret string of the form `'user:pass'`).
 *
 * @example
 * ```ts
 * import { postmark, verifyPostmarkBasicAuth } from '@paysuite/webhook-toolkit/providers/postmark';
 * if (!verifyPostmarkBasicAuth({ headers, user, pass })) return new Response('unauthorized', { status: 401 });
 * ```
 */
export const postmark: WebhookProvider<PostmarkEvent> = {
  id: 'postmark',
  algorithm: 'HMAC-SHA256', // Tag only; Postmark doesn't actually HMAC.

  parseSignature: (headers) => {
    const a = headers.get('authorization');
    return a && a.startsWith('Basic ') ? { signatures: [new Uint8Array(0)], raw: a } : null;
  },

  extractTimestamp: () => null,

  verify: async ({ secret, headers }) => {
    // `secret` for Postmark is the `'user:pass'` string verbatim.
    const decoded = utf8.decode(secret);
    const colon = decoded.indexOf(':');
    if (colon < 0) return false;
    return verifyPostmarkBasicAuth({
      headers,
      user: decoded.slice(0, colon),
      pass: decoded.slice(colon + 1),
    });
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as PostmarkEvent,

  idempotencyKey: (_input, event) => event.MessageID ?? null,
};
