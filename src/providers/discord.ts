import { hex, utf8 } from '../core/encoding.js';
import { normalizeEd25519PublicKey, verifyEd25519 } from '../core/crypto.js';
import type { WebhookProvider } from '../core/types.js';

// Cache the normalized 32-byte raw key per provided secret bytes so PEM /
// hex / base64 inputs aren't re-decoded on every request. Combined with
// `core/crypto.ts`'s `CryptoKey` cache (keyed on the same returned
// Uint8Array), Ed25519 verification reduces to one `subtle.verify` call.
const normalizedKeyCache = new WeakMap<Uint8Array, Uint8Array>();

function getPublicKey(secret: Uint8Array): Uint8Array {
  const cached = normalizedKeyCache.get(secret);
  if (cached) return cached;
  const normalized = normalizeEd25519PublicKey(secret);
  normalizedKeyCache.set(secret, normalized);
  return normalized;
}

/** Discord interaction payload — discriminated by `type` (numeric). */
export type DiscordInteractionEvent = {
  readonly id?: string;
  readonly type?: number;
  readonly [k: string]: unknown;
};

/**
 * Discord interactions webhook provider. Uses Ed25519 over
 * `${X-Signature-Timestamp}${rawBody}` and the **application public key**
 * as the "secret" — accepts raw 32-byte hex / base64 / PEM.
 *
 * @example
 * ```ts
 * import { discord } from '@paysuite/webhook-toolkit/providers/discord';
 * createVerifier({ provider: discord, secret: process.env.DISCORD_PUBLIC_KEY! });
 * ```
 */
export const discord: WebhookProvider<DiscordInteractionEvent> = {
  id: 'discord',
  algorithm: 'Ed25519',

  parseSignature: (headers) => {
    const raw = headers.get('x-signature-ed25519');
    if (!raw) return null;
    return { signatures: [hex.decode(raw.trim())], raw };
  },

  extractTimestamp: (headers) => {
    const v = headers.get('x-signature-timestamp');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n * 1000 : null;
  },

  verify: async ({ signature, secret, rawBody, timestamp }) => {
    const publicKey = getPublicKey(secret);
    const seconds = Math.floor((timestamp ?? 0) / 1000);
    const tsBytes = utf8.encode(String(seconds));
    const data = new Uint8Array(tsBytes.length + rawBody.length);
    data.set(tsBytes, 0);
    data.set(rawBody, tsBytes.length);
    return verifyEd25519(publicKey, signature, data);
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as DiscordInteractionEvent,

  idempotencyKey: (_input, event) => event.id ?? null,
};
