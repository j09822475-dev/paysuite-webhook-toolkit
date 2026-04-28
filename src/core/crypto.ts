import { configError } from '../errors/index.js';
import { base64, base64url, hex, utf8 } from './encoding.js';

/**
 * The Web Crypto interface used by the library. Bound at module load
 * from `globalThis.crypto`; tests can supply their own via the
 * `crypto` option on a verifier in the future.
 */
function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw configError(
      'Web Crypto (`globalThis.crypto.subtle`) is unavailable. Use Node 18.17+ or a runtime that exposes Web Crypto.',
    );
  }
  return c.subtle;
}

/**
 * Coerce a string or `Uint8Array` secret to bytes. Strings are treated as
 * UTF-8 — provider plugins are responsible for decoding hex/base64 secrets
 * via {@link normalizeSecret} when the provider's docs require it.
 *
 * @param secret - Secret as string (UTF-8) or raw bytes.
 * @returns `Uint8Array` view of the secret.
 */
export function secretToBytes(secret: string | Uint8Array): Uint8Array {
  return typeof secret === 'string' ? utf8.encode(secret) : secret;
}

/**
 * Compute HMAC-SHA256 over `data` with `key`.
 *
 * @param key  - Raw HMAC key bytes.
 * @param data - Bytes to authenticate.
 * @returns 32-byte digest.
 */
export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return hmac('SHA-256', key, data);
}

/**
 * Compute HMAC-SHA1 over `data` with `key`. Used by Twilio and Vercel.
 *
 * @param key  - Raw HMAC key bytes.
 * @param data - Bytes to authenticate.
 * @returns 20-byte digest.
 */
export async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return hmac('SHA-1', key, data);
}

async function hmac(hash: 'SHA-256' | 'SHA-1', key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  const cryptoKey = await subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: { name: hash } },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', cryptoKey, data as BufferSource);
  return new Uint8Array(sig);
}

/**
 * Normalize an Ed25519 public key to raw 32 bytes. Accepts:
 * - `Uint8Array` of length 32 (raw)
 * - hex string of length 64
 * - base64 / base64url string decoding to 32 bytes
 * - PEM (`-----BEGIN PUBLIC KEY-----` SubjectPublicKeyInfo, DER inside)
 *
 * @param key - Public key in one of the supported encodings.
 * @returns Raw 32-byte Ed25519 public key.
 * @throws {WebhookError} (code `CONFIG`) if `key` cannot be parsed to 32 bytes.
 */
export function normalizeEd25519PublicKey(key: string | Uint8Array): Uint8Array {
  if (key instanceof Uint8Array) {
    if (key.length === 32) return key;
    throw configError(`Ed25519 public key must be 32 bytes; got ${String(key.length)}`);
  }
  const trimmed = key.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    const pem = trimmed.replace(/-----BEGIN PUBLIC KEY-----/, '').replace(/-----END PUBLIC KEY-----/, '').replace(/\s+/g, '');
    const der = base64.decode(pem);
    // SubjectPublicKeyInfo for Ed25519 is 12 bytes of header + 32 bytes of key.
    if (der.length < 32) throw configError('Ed25519 PEM too short to contain a public key');
    return der.slice(der.length - 32);
  }
  // Try hex first, then base64/base64url.
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    const bytes = hex.decode(trimmed);
    if (bytes.length === 32) return bytes;
    throw configError(`Ed25519 hex public key must decode to 32 bytes; got ${String(bytes.length)}`);
  }
  try {
    const bytes = trimmed.includes('-') || trimmed.includes('_')
      ? base64url.decode(trimmed)
      : base64.decode(trimmed);
    if (bytes.length === 32) return bytes;
    throw configError(`Ed25519 public key must decode to 32 bytes; got ${String(bytes.length)}`);
  } catch (cause) {
    throw configError('Ed25519 public key could not be parsed (expected raw 32B / hex / base64 / PEM)', '', { cause: String(cause) });
  }
}

// `importKey` is the expensive part of Ed25519 verification (the math is
// fast). Cache the imported `CryptoKey` per raw 32-byte public key so a
// process verifying one or two rotation keys doesn't re-import on every
// request. Keyed by the raw bytes' identity — providers normalize once
// and reuse the same `Uint8Array` per call (see `normalizeEd25519PublicKey`).
const ed25519KeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();

function importEd25519Key(publicKey: Uint8Array): Promise<CryptoKey> {
  const cached = ed25519KeyCache.get(publicKey);
  if (cached) return cached;
  const subtle = getSubtle();
  const promise = subtle
    .importKey('raw', publicKey as BufferSource, { name: 'Ed25519' }, false, ['verify'])
    .catch((cause: unknown) => {
      // Don't poison the cache on a runtime-support failure.
      ed25519KeyCache.delete(publicKey);
      throw configError(
        'Ed25519 verification is not supported by this runtime. Upgrade to Node 20+ or use Bun/Deno/CF Workers.',
        '',
        { cause: String(cause) },
      );
    });
  ed25519KeyCache.set(publicKey, promise);
  return promise;
}

/**
 * Verify an Ed25519 signature over `data` with the given raw 32-byte public key.
 *
 * Some Node 18 patch versions reject Ed25519 in WebCrypto; this function
 * surfaces the original error wrapped as a `CONFIG` error so users get a
 * clear remediation hint (upgrade to Node 20+ or use a different runtime).
 *
 * @param publicKey - Raw 32-byte Ed25519 public key.
 * @param signature - 64-byte signature produced by the provider.
 * @param data      - Signed bytes.
 * @returns `true` if the signature is valid for `(publicKey, data)`.
 * @throws {WebhookError} (code `CONFIG`) if Ed25519 is unsupported by the host runtime.
 */
export async function verifyEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const subtle = getSubtle();
  const cryptoKey = await importEd25519Key(publicKey);
  return subtle.verify('Ed25519', cryptoKey, signature as BufferSource, data as BufferSource);
}
