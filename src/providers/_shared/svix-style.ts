import { base64 } from '../../core/encoding.js';

/**
 * Parser for Standard Webhooks (Svix) signature headers of the form
 * `v1,<base64>` or `v1,<base64> v1,<other-base64>` (space-separated).
 *
 * The `v1` prefix marks the algorithm version; this library supports
 * `v1` (HMAC-SHA256, base64-encoded). Unknown prefixes are skipped.
 */
export const svixStyleSignature = {
  /**
   * Parse a Standard Webhooks signature header.
   *
   * @param raw - Raw `webhook-signature` header value.
   * @returns Array of decoded `Uint8Array` signatures (one per `v1,` entry).
   *
   * @example
   * ```ts
   * svixStyleSignature.parse('v1,abcdef== v1,xyz123==');
   * ```
   */
  parse(raw: string): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const part of raw.split(' ')) {
      const comma = part.indexOf(',');
      if (comma < 0) continue;
      const version = part.slice(0, comma).trim();
      const value = part.slice(comma + 1).trim();
      if (version !== 'v1') continue;
      try {
        out.push(base64.decode(value));
      } catch {
        // Skip malformed entries; verifier will reject if no usable signature remains.
      }
    }
    return out;
  },
};
