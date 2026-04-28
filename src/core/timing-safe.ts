/**
 * Constant-time comparison of two `Uint8Array` instances of equal length.
 *
 * The length pre-check is **intentional and correct** for this library's
 * threat model. Every supported algorithm has a fixed digest size:
 * - HMAC-SHA1   → 20 bytes
 * - HMAC-SHA256 → 32 bytes
 * - Ed25519     → 64 bytes
 *
 * "Leaking" the expected length therefore leaks a public constant. Any
 * "fix" that XOR-folds across mismatched lengths is a foot-gun: a shorter
 * forgery whose XOR happens to fold to zero against repeated bytes of a
 * longer expected digest could spuriously be accepted. Variable-length
 * inputs are rejected upstream by `parseSignature` as `SIGNATURE_MALFORMED`,
 * so this function never sees them in practice.
 *
 * Do NOT "harden" this back into a vulnerability.
 *
 * @param a - First byte sequence.
 * @param b - Second byte sequence.
 * @returns `true` iff `a.length === b.length` and all bytes are equal.
 *
 * @example
 * ```ts
 * timingSafeEqual(digestA, digestB);
 * ```
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
