import { utf8 } from '../core/encoding.js';
import type { HeaderBag, WebhookProvider } from '../core/types.js';
import { svixStyleSignature } from './_shared/svix-style.js';

/** Standard Webhooks (Svix) payload — generic shape. */
export type SvixEvent = {
  readonly type?: string;
  readonly [k: string]: unknown;
};

/**
 * Build the Standard Webhooks (Svix) signing string:
 * `${webhook-id}.${webhook-timestamp}.${rawBody}`.
 *
 * Exported for `clerk` / `resend` reuse; public so users can verify the
 * format manually if needed.
 */
export function buildSvixSigningString(input: {
  rawBody: Uint8Array;
  timestamp: number | null;
  headers: HeaderBag;
}): Uint8Array {
  const id = input.headers.get('webhook-id') ?? '';
  const seconds = Math.floor((input.timestamp ?? 0) / 1000);
  const prefix = utf8.encode(`${id}.${String(seconds)}.`);
  const out = new Uint8Array(prefix.length + input.rawBody.length);
  out.set(prefix, 0);
  out.set(input.rawBody, prefix.length);
  return out;
}

/**
 * Build a Svix-style provider plugin. Used directly for `svix` and
 * re-used by `clerk` and `resend` (they share the format).
 *
 * Headers:
 * - `webhook-id`        — message id (idempotency key)
 * - `webhook-timestamp` — Unix seconds
 * - `webhook-signature` — `v1,<base64> [v1,<other-base64>]` (rotation)
 *
 * Signing string: `${webhook-id}.${webhook-timestamp}.${rawBody}`.
 *
 * @param id - Provider id used in logs / metrics. Default `'svix'`.
 * @returns A `WebhookProvider<SvixEvent>` ready for `createVerifier`.
 */
export function svixStyleProvider(id = 'svix'): WebhookProvider<SvixEvent> {
  return {
    id,
    algorithm: 'HMAC-SHA256',

    parseSignature: (headers) => {
      const raw = headers.get('webhook-signature');
      if (!raw) return null;
      const sigs = svixStyleSignature.parse(raw);
      if (sigs.length === 0) return null;
      return { signatures: sigs, raw };
    },

    extractTimestamp: (headers) => {
      const v = headers.get('webhook-timestamp');
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n * 1000 : null;
    },

    buildSigningString: ({ rawBody, timestamp, headers }) =>
      buildSvixSigningString({ rawBody, timestamp, headers }),

    parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as SvixEvent,

    idempotencyKey: (input) => input.headers.get('webhook-id'),
  };
}

/**
 * Standard Webhooks / Svix provider — vendor-neutral entry point.
 *
 * @example
 * ```ts
 * import { svix } from '@paysuite/webhook-toolkit/providers/svix';
 * createVerifier({ provider: svix, secret: process.env.SVIX_SECRET! });
 * ```
 */
export const svix: WebhookProvider<SvixEvent> = svixStyleProvider('svix');
