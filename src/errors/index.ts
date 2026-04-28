/**
 * Discriminant for {@link WebhookError}. Branch on `error.code` rather than
 * `instanceof` subclasses — `instanceof` is a footgun when bundlers ship
 * multiple copies of the library across module boundaries.
 *
 * Recommended HTTP status mapping:
 * - `CONFIG`                    → 500 (thrown synchronously, never returned)
 * - `SIGNATURE_MISSING`         → 400
 * - `SIGNATURE_MALFORMED`       → 400
 * - `SIGNATURE_MISMATCH`        → 401
 * - `TIMESTAMP_MISSING`         → 400
 * - `TIMESTAMP_INVALID`         → 400
 * - `REPLAY_WINDOW_EXCEEDED`    → 400
 * - `PAYLOAD_PARSE`             → 400
 * - `PAYLOAD_TOO_LARGE`         → 413
 * - `UNSUPPORTED_ALGORITHM`     → 500
 * - `IDEMPOTENCY_DUPLICATE`     → 200 ('skip' default) | 409 ('error' mode)
 * - `IDEMPOTENCY_STORE`         → 503
 */
export type ErrorCode =
  | 'CONFIG'
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_MISMATCH'
  | 'TIMESTAMP_MISSING'
  | 'TIMESTAMP_INVALID'
  | 'REPLAY_WINDOW_EXCEEDED'
  | 'PAYLOAD_PARSE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_ALGORITHM'
  | 'IDEMPOTENCY_DUPLICATE'
  | 'IDEMPOTENCY_STORE';

/** Set of error codes that are masked to `'invalid_signature'` on the wire. */
export const SIGNATURE_FAMILY: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'SIGNATURE_MISSING',
  'SIGNATURE_MALFORMED',
  'SIGNATURE_MISMATCH',
  'TIMESTAMP_MISSING',
  'TIMESTAMP_INVALID',
  'REPLAY_WINDOW_EXCEEDED',
]);

/** Constructor arguments for {@link WebhookError}. */
export interface WebhookErrorArgs {
  readonly code: ErrorCode;
  readonly message: string;
  readonly httpStatus: number;
  readonly providerId?: string;
  readonly meta?: Record<string, unknown>;
  readonly cause?: unknown;
}

/**
 * The single error class for every failure mode in the library.
 *
 * Failure modes are discriminated by `code` (a string-literal union),
 * not by subclass. A single class keeps `errors/` under bundle budget
 * and avoids the `instanceof`-across-module-boundaries footgun where
 * bundlers ship multiple copies of the class and `instanceof` silently
 * returns `false`.
 *
 * @example
 * ```ts
 * if (!result.ok) {
 *   if (result.error.code === 'REPLAY_WINDOW_EXCEEDED') {
 *     metrics.increment('replay.exceeded', { providerId: result.error.providerId });
 *   }
 *   return new Response(result.error.message, { status: result.error.httpStatus });
 * }
 * ```
 */
export class WebhookError extends Error {
  /** Discriminant. Always check this, not `instanceof` subclasses. */
  public readonly code: ErrorCode;
  /** Recommended HTTP status to return to the provider. */
  public readonly httpStatus: number;
  /** Provider id (for logs / metrics). `''` for `CONFIG` errors thrown before a provider is bound. */
  public readonly providerId: string;
  /** Structured metadata; never contains secrets or raw bodies. */
  public readonly meta: Record<string, unknown>;

  /**
   * Construct a `WebhookError`.
   *
   * @param args.code        Discriminant; see {@link ErrorCode}.
   * @param args.message     Human-readable message. Safe to log; must not contain secrets.
   * @param args.httpStatus  Recommended HTTP status code.
   * @param args.providerId  Provider identifier, or `''` for pre-binding `CONFIG` errors.
   * @param args.meta        Extra structured metadata. Never include the secret, raw body, or signature header.
   * @param args.cause       Underlying cause for chained errors.
   */
  public constructor(args: WebhookErrorArgs) {
    super(args.message, args.cause !== undefined ? { cause: args.cause } : undefined);
    this.name = 'WebhookError';
    this.code = args.code;
    this.httpStatus = args.httpStatus;
    this.providerId = args.providerId ?? '';
    this.meta = args.meta ?? {};
  }
}

/**
 * Construct a `CONFIG` error. Thrown synchronously from factory functions
 * when the user's setup is invalid (missing secret, unknown algorithm, ...).
 *
 * @param message     Description of the misconfiguration.
 * @param providerId  Provider id, or `''` if the error happened before provider binding.
 * @param meta        Extra structured metadata for logs.
 * @returns           A `CONFIG`-coded `WebhookError` with HTTP status 500.
 *
 * @example
 * ```ts
 * if (!options.secret) throw configError('secret is required');
 * ```
 */
export function configError(
  message: string,
  providerId = '',
  meta: Record<string, unknown> = {},
): WebhookError {
  return new WebhookError({ code: 'CONFIG', message, httpStatus: 500, providerId, meta });
}
