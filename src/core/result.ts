/**
 * A `Result` discriminated union — Rust-style success/failure carrier.
 *
 * The library uses this internally; `VerificationResult` is the public-
 * facing alias with named `event` instead of `value`.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Construct a successful `Result`.
 *
 * @param value - The success payload.
 * @returns An `Ok` result.
 *
 * @example
 * ```ts
 * const r = Ok(42);
 * if (r.ok) console.log(r.value); // 42
 * ```
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Construct a failed `Result`.
 *
 * @param error - The error payload.
 * @returns An `Err` result.
 *
 * @example
 * ```ts
 * const r = Err(new Error('nope'));
 * if (!r.ok) console.error(r.error.message);
 * ```
 */
export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
