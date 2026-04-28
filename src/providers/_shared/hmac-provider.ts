import { base64, base64url, hex, utf8 } from '../../core/encoding.js';
import type { HeaderBag, SignatureAlgorithm, WebhookProvider } from '../../core/types.js';

/** Encoding of the signature value carried in the header. */
export type SignatureEncoding = 'hex' | 'base64' | 'base64url';

/** Parameters describing a simple HMAC-style provider. */
export interface SimpleHmacProviderSpec<TEvent> {
  readonly id: string;
  readonly algorithm: SignatureAlgorithm;
  /** Header that carries the signature. */
  readonly signatureHeader: string;
  /** How the signature is encoded in the header. Default `'hex'`. */
  readonly signatureEncoding?: SignatureEncoding;
  /**
   * Optional prefix in the header (e.g. `'sha256='` for GitHub). Stripped
   * before decoding.
   */
  readonly signaturePrefix?: string;
  /**
   * Optional header that carries the timestamp. Returned as-is to
   * `extractTimestamp`; the function below converts it to ms.
   */
  readonly timestampHeader?: string;
  /**
   * Whether `timestampHeader` is in seconds (default) or milliseconds.
   */
  readonly timestampUnit?: 'seconds' | 'milliseconds';
  /**
   * Build the byte sequence the provider HMAC'd. Default is the raw body
   * unchanged (the GitHub / Shopify / Linear convention).
   */
  readonly buildSigningString?: WebhookProvider<TEvent>['buildSigningString'];
  /** Extract idempotency key from a verified event. */
  readonly idempotencyKey?: WebhookProvider<TEvent>['idempotencyKey'];
  /** Optional event parser. Default JSON.parse over UTF-8. */
  readonly parseEvent?: (rawBody: Uint8Array) => TEvent;
}

/**
 * Build a `WebhookProvider` for the common single-header HMAC pattern
 * used by GitHub, Shopify, Linear, Lemon Squeezy, etc.
 *
 * @typeParam TEvent - Provider event union.
 * @param spec - Provider description (header names, encoding, etc.).
 * @returns A `WebhookProvider<TEvent>` ready to pass to `createVerifier`.
 *
 * @example
 * ```ts
 * export const linear = simpleHmacProvider({
 *   id: 'linear',
 *   algorithm: 'HMAC-SHA256',
 *   signatureHeader: 'linear-signature',
 *   signatureEncoding: 'hex',
 * });
 * ```
 */
export function simpleHmacProvider<TEvent>(
  spec: SimpleHmacProviderSpec<TEvent>,
): WebhookProvider<TEvent> {
  const encoding: SignatureEncoding = spec.signatureEncoding ?? 'hex';
  const prefix = spec.signaturePrefix ?? '';
  const tsUnit = spec.timestampUnit ?? 'seconds';

  return {
    id: spec.id,
    algorithm: spec.algorithm,

    parseSignature: (headers: HeaderBag) => {
      const raw = headers.get(spec.signatureHeader);
      if (!raw) return null;
      let value = raw.trim();
      if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
      const decoded = decodeBy(encoding, value);
      return { signatures: [decoded], raw };
    },

    extractTimestamp: (headers) => {
      if (!spec.timestampHeader) return null;
      const v = headers.get(spec.timestampHeader);
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return tsUnit === 'seconds' ? n * 1000 : n;
    },

    buildSigningString: spec.buildSigningString ?? (({ rawBody }) => rawBody),

    parseEvent: spec.parseEvent ?? ((raw) => JSON.parse(utf8.decode(raw)) as TEvent),

    ...(spec.idempotencyKey ? { idempotencyKey: spec.idempotencyKey } : {}),
  };
}

function decodeBy(encoding: SignatureEncoding, value: string): Uint8Array {
  if (encoding === 'hex') return hex.decode(value);
  if (encoding === 'base64') return base64.decode(value);
  return base64url.decode(value);
}
