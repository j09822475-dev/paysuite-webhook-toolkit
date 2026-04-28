import { hmacSha1, hmacSha256, secretToBytes } from '../core/crypto.js';
import { base64, hex, utf8 } from '../core/encoding.js';
import { fromRecord } from '../core/headers.js';
import type { WebhookProvider } from '../core/types.js';

/** Options for `signWith`. */
export interface SignOptions {
  /** Provider signing secret (string is treated as UTF-8). */
  readonly secret: string | Uint8Array;
  /** Payload to sign. Strings are UTF-8 encoded; objects are `JSON.stringify`d. */
  readonly payload: string | Uint8Array | Record<string, unknown> | Array<unknown>;
  /** Timestamp in seconds. Defaults to `Math.floor(Date.now() / 1000)`. */
  readonly timestamp?: number;
  /**
   * Webhook id for Svix-style providers. Default `'msg_test'`.
   * Ignored by other providers.
   */
  readonly webhookId?: string;
  /** Full request URL — required by Twilio and Square. Default empty. */
  readonly url?: string;
}

/** Result of a successful sign call. */
export interface SignedRequest {
  /** Headers to send with the request. */
  readonly headers: Record<string, string>;
  /** The raw body to send (already encoded). */
  readonly rawBody: Uint8Array;
  /** Convenience: the raw body decoded as UTF-8 (always JSON for the providers shipped). */
  readonly bodyText: string;
}

/**
 * Produce a valid signature + headers for a given provider plugin.
 * Useful for writing integration tests against your webhook handlers
 * without depending on the real provider's SDK.
 *
 * Supports every provider shipped in v0.1 except Mailgun (whose
 * signature lives inside the JSON body — generate manually if needed)
 * and Postmark (Basic auth, not signature-based).
 *
 * @param provider - The provider plugin.
 * @param options  - `secret`, `payload`, optional `timestamp`, `webhookId`, `url`.
 * @returns        - `{ headers, rawBody, bodyText }` to drive a test request.
 *
 * @throws {Error} If the provider is unsupported (Mailgun / Postmark) or
 *                 the algorithm has no built-in signer (Ed25519 — supply
 *                 the signature manually with a real keypair).
 *
 * @example
 * ```ts
 * import { signWith } from '@paysuite/webhook-toolkit/testing';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const { headers, rawBody } = await signWith(stripe, {
 *   secret: 'whsec_test',
 *   payload: { type: 'payment_intent.succeeded', id: 'evt_1', data: { object: { id: 'pi_1' } } },
 *   timestamp: 1714200000,
 * });
 * ```
 */
export async function signWith(
  provider: WebhookProvider,
  options: SignOptions,
): Promise<SignedRequest> {
  const secret = secretToBytes(options.secret);
  const rawBody =
    options.payload instanceof Uint8Array
      ? options.payload
      : typeof options.payload === 'string'
        ? utf8.encode(options.payload)
        : utf8.encode(JSON.stringify(options.payload));
  const bodyText = utf8.decode(rawBody);
  const timestampSeconds = options.timestamp ?? Math.floor(Date.now() / 1000);
  const url = options.url ?? '';

  switch (provider.id) {
    case 'stripe': {
      const sig = await hmacSha256(secret, utf8.encode(`${String(timestampSeconds)}.${bodyText}`));
      return {
        headers: { 'stripe-signature': `t=${String(timestampSeconds)},v1=${hex.encode(sig)}` },
        rawBody,
        bodyText,
      };
    }
    case 'github': {
      const sig = await hmacSha256(secret, rawBody);
      return {
        headers: {
          'x-hub-signature-256': `sha256=${hex.encode(sig)}`,
          'x-github-delivery': options.webhookId ?? 'test-delivery-1',
        },
        rawBody,
        bodyText,
      };
    }
    case 'shopify': {
      const sig = await hmacSha256(secret, rawBody);
      return {
        headers: {
          'x-shopify-hmac-sha256': base64.encode(sig),
          'x-shopify-webhook-id': options.webhookId ?? 'whk_test_1',
        },
        rawBody,
        bodyText,
      };
    }
    case 'twilio': {
      const fields = parseFormBody(bodyText);
      const keys = [...fields.keys()].sort();
      let s = url;
      for (const k of keys) s += k + (fields.get(k) ?? '');
      const sig = await hmacSha1(secret, utf8.encode(s));
      return {
        headers: { 'x-twilio-signature': base64.encode(sig) },
        rawBody,
        bodyText,
      };
    }
    case 'slack': {
      const sig = await hmacSha256(secret, utf8.encode(`v0:${String(timestampSeconds)}:${bodyText}`));
      return {
        headers: {
          'x-slack-signature': `v0=${hex.encode(sig)}`,
          'x-slack-request-timestamp': String(timestampSeconds),
        },
        rawBody,
        bodyText,
      };
    }
    case 'svix':
    case 'clerk':
    case 'resend': {
      const id = options.webhookId ?? 'msg_test';
      const sig = await hmacSha256(secret, utf8.encode(`${id}.${String(timestampSeconds)}.${bodyText}`));
      return {
        headers: {
          'webhook-id': id,
          'webhook-timestamp': String(timestampSeconds),
          'webhook-signature': `v1,${base64.encode(sig)}`,
        },
        rawBody,
        bodyText,
      };
    }
    case 'linear': {
      const sig = await hmacSha256(secret, rawBody);
      return {
        headers: { 'linear-signature': hex.encode(sig) },
        rawBody,
        bodyText,
      };
    }
    case 'vercel': {
      const sig = await hmacSha1(secret, rawBody);
      return {
        headers: {
          'x-vercel-signature': hex.encode(sig),
          'x-vercel-delivery': options.webhookId ?? 'dlv_test_1',
        },
        rawBody,
        bodyText,
      };
    }
    case 'lemon-squeezy': {
      const sig = await hmacSha256(secret, rawBody);
      return {
        headers: {
          'x-signature': hex.encode(sig),
          'x-event-id': options.webhookId ?? 'evt_test_1',
        },
        rawBody,
        bodyText,
      };
    }
    case 'paddle': {
      const sig = await hmacSha256(secret, utf8.encode(`${String(timestampSeconds)}:${bodyText}`));
      return {
        headers: { 'paddle-signature': `ts=${String(timestampSeconds)};h1=${hex.encode(sig)}` },
        rawBody,
        bodyText,
      };
    }
    case 'square': {
      const sig = await hmacSha256(secret, utf8.encode(`${url}${bodyText}`));
      return {
        headers: { 'x-square-hmacsha256-signature': base64.encode(sig) },
        rawBody,
        bodyText,
      };
    }
    case 'discord':
    case 'sendgrid':
      throw new Error(
        `signWith does not generate Ed25519 signatures for '${provider.id}'. Use a real Ed25519 keypair for these provider tests.`,
      );
    case 'mailgun':
      throw new Error(
        `signWith does not generate Mailgun signatures (lives in body). Construct the body manually for tests.`,
      );
    case 'postmark':
      throw new Error(
        `Postmark uses Basic auth, not signatures. Use HTTP \`Authorization\` headers directly.`,
      );
    default: {
      // Generic provider: assume HMAC-SHA256 over rawBody if `buildSigningString` is missing.
      void fromRecord; // placeholder reference
      const stringToSign = provider.buildSigningString
        ? provider.buildSigningString({ rawBody, timestamp: timestampSeconds * 1000, url, method: 'POST', headers: fromRecord({}) })
        : rawBody;
      const sig =
        provider.algorithm === 'HMAC-SHA1'
          ? await hmacSha1(secret, stringToSign)
          : await hmacSha256(secret, stringToSign);
      return {
        headers: { 'x-signature': hex.encode(sig) },
        rawBody,
        bodyText,
      };
    }
  }
}

function parseFormBody(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out.set(k, v);
  }
  return out;
}
