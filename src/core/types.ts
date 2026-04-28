import type { WebhookError } from '../errors/index.js';

/**
 * Tag used by providers solely for telemetry. The library does NOT branch
 * on this value; the actual crypto primitive is determined by which
 * `core/crypto.ts` helper the provider invokes.
 */
export type SignatureAlgorithm = 'HMAC-SHA256' | 'HMAC-SHA1' | 'Ed25519';

/**
 * Any of the runtime-native shapes that can be turned into a `Uint8Array`
 * by `core/body.ts`. Adapters always feed a buffered raw body to the
 * verifier; pre-parsed JSON is never trusted.
 */
export type RawBodyInput = Uint8Array | ArrayBuffer | string | ReadableStream<Uint8Array>;

/**
 * Case-insensitive read-only view over HTTP headers. Backed by either
 * fetch `Headers`, Node `IncomingHttpHeaders`, or a plain record — see
 * `core/headers.ts` for constructors.
 */
export interface HeaderBag {
  /** Returns the (joined) value for `name`, or `null` if absent. Case-insensitive. */
  get(name: string): string | null;
  /** True if the bag contains `name`. Case-insensitive. */
  has(name: string): boolean;
  /** Iterate `[name, value]` pairs with names normalized to lowercase. */
  entries(): IterableIterator<[string, string]>;
}

/**
 * Normalized inbound request that the verifier and provider plugins
 * operate on. Adapters produce one of these from framework-specific input.
 */
export interface NormalizedRequest {
  readonly headers: HeaderBag;
  readonly rawBody: Uint8Array;
  readonly url: string;
  readonly method: string;
}

/**
 * What `Verifier#verify` accepts. A standard `Request`, a `NormalizedRequest`,
 * or a flexible `{ headers, rawBody, url?, method? }` escape hatch.
 */
export type VerifierInput =
  | Request
  | NormalizedRequest
  | {
      readonly headers: HeadersInit | Record<string, string | string[] | undefined>;
      readonly rawBody: RawBodyInput;
      readonly url?: string;
      readonly method?: string;
    };

/** Wall-clock source. Substitute in tests via `Clock`-providing options. */
export interface Clock {
  /** Current time in epoch milliseconds. */
  now(): number;
}

/** Structured logger. Library emits `verify.ok`, `verify.fail`, `verify.replay`, etc. */
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Counter-only metrics sink. The library increments these names with
 * `{ providerId, code? }` tags:
 *
 * - `verify.ok`              — successful verification
 * - `verify.fail`            — any verification failure (use `code` to discriminate)
 * - `replay.exceeded`        — timestamp outside tolerance window
 * - `idempotency.duplicate`  — emitted by `withIdempotency`
 * - `idempotency.store_error`— store unavailable
 */
export interface Metrics {
  /** Increment a counter named `name`, optionally tagged. */
  increment(name: string, tags?: Record<string, string>): void;
}

/**
 * A `WebhookProvider` is a strategy of small pure functions describing how
 * to verify one vendor's webhook format. The core verifier orchestrates
 * these steps — providers never compare bytes, never call `Date.now()`,
 * never decide whether a signature is "good".
 *
 * @typeParam TEvent - The discriminated event union the provider's
 *                     `parseEvent` produces from a verified raw body.
 */
export interface WebhookProvider<TEvent = unknown> {
  /** Stable identifier — used in logs, metrics, and the typed router. */
  readonly id: string;

  /**
   * Algorithm tag. Surfaced in logs / metrics ONLY — control flow is not
   * driven from this field; the crypto choice is implicit in `verify`
   * (which `core/crypto.ts` helper the provider invokes).
   */
  readonly algorithm: SignatureAlgorithm;

  /**
   * Step 1 — extract the candidate signature(s) from headers.
   *
   * Returns `null` if the required header is absent (verifier surfaces
   * `SIGNATURE_MISSING`). A malformed value should also return `null`
   * or throw; the verifier maps thrown errors to `SIGNATURE_MALFORMED`.
   *
   * Multiple `signatures[]` covers Stripe's `t=…,v1=A,v1=B` rotation
   * scheme — the verifier tries every entry × every secret.
   */
  readonly parseSignature: (headers: HeaderBag) => { signatures: Uint8Array[]; raw: string } | null;

  /**
   * Step 2 — extract the request timestamp in **epoch milliseconds**.
   *
   * Return `null` for providers that don't sign a timestamp (Shopify,
   * GitHub-classic). The verifier then skips replay-window enforcement
   * but still emits a single `replay.unsupported` log per process.
   */
  readonly extractTimestamp: (headers: HeaderBag, rawBody: Uint8Array) => number | null;

  /**
   * Step 3 — build the exact byte sequence the provider HMAC'd, OR
   * perform full verification for non-HMAC providers (Ed25519 / Postmark).
   *
   * Defining `verify` instead of `buildSigningString` is allowed for
   * providers whose signing string is not a simple concat (e.g. Twilio
   * mixes URL + sorted form fields).
   *
   * The verifier calls `verify` once per (signature × secret) pair if
   * provided; otherwise it calls `buildSigningString` and HMACs each
   * (secret, string) pair in core.
   *
   * `headers` is included so providers like Svix (whose signing string
   * incorporates the `webhook-id` header value) can be expressed without
   * dropping to the `verify` escape hatch.
   */
  readonly buildSigningString?: (input: {
    rawBody: Uint8Array;
    timestamp: number | null;
    url: string;
    method: string;
    headers: HeaderBag;
  }) => Uint8Array;

  /**
   * Optional escape hatch — perform the full crypto check for one
   * (signature, secret) pair. Required for Ed25519 providers (Discord,
   * SendGrid) and providers whose verification doesn't fit the HMAC
   * shape (Postmark BasicAuth helper).
   */
  readonly verify?: (input: {
    signature: Uint8Array;
    secret: Uint8Array;
    rawBody: Uint8Array;
    timestamp: number | null;
    url: string;
    method: string;
    headers: HeaderBag;
  }) => Promise<boolean>;

  /**
   * Step 4 — parse the verified raw body into the typed event union.
   * Runs ONLY after the signature is validated.
   */
  readonly parseEvent: (rawBody: Uint8Array) => TEvent;

  /**
   * Optional — provider-specific idempotency key. Stripe returns
   * `event.id`, GitHub returns `X-GitHub-Delivery`, Svix returns
   * `webhook-id`. The verifier namespaces it as `${providerId}:${key}`.
   */
  readonly idempotencyKey?: (input: NormalizedRequest, event: TEvent) => string | null;

  /** Phantom marker — preserves the event union through generic inference. */
  readonly __eventMarker?: TEvent;
}

/** Public spec passed to `defineWebhookProvider`; structurally identical to {@link WebhookProvider}. */
export type WebhookProviderSpec<TEvent = unknown> = WebhookProvider<TEvent>;

/** @deprecated Use {@link WebhookProvider}. Internal alias retained for terseness. */
export type Provider<TEvent = unknown> = WebhookProvider<TEvent>;

/** Extracts the event payload type from a `WebhookProvider`. */
export type EventOf<P extends WebhookProvider<any>> = P extends WebhookProvider<infer TEvent> ? TEvent : never;

/**
 * Discriminated success/failure return from `Verifier#verify`. On `ok: true`
 * the event is fully typed; on `ok: false` `error.code` discriminates the
 * failure.
 */
export type VerificationResult<TEvent> =
  | {
      readonly ok: true;
      readonly event: TEvent;
      readonly rawBody: Uint8Array;
      readonly idempotencyKey: string | null;
      readonly receivedAt: number;
    }
  | { readonly ok: false; readonly error: WebhookError };

/**
 * Stateless, runtime-agnostic verifier produced by `createVerifier`.
 */
export interface Verifier<P extends WebhookProvider<any>> {
  readonly providerId: string;
  /** Phantom marker carrying the provider type forward for compositional typing. */
  readonly __providerMarker?: P;
  /**
   * Verify any input shape — `Request`, `NormalizedRequest`, or
   * `{ headers, rawBody }`. ALWAYS returns a `VerificationResult`;
   * never throws on a bad signature.
   */
  verify(input: VerifierInput): Promise<VerificationResult<EventOf<P>>>;
}

/** Options for `createVerifier`. */
export interface VerifierOptions<P extends WebhookProvider<any>> {
  /** Provider plugin (`stripe`, `github`, …). */
  readonly provider: P;
  /**
   * Single secret OR an array. The array form is the **zero-downtime key
   * rotation** path — every entry is tried with timing-safe equality and
   * the request verifies if any match. Pass new secret first, old second.
   */
  readonly secret: string | Uint8Array | ReadonlyArray<string | Uint8Array>;
  /** Replay tolerance in seconds. Default 300. `Infinity` disables. */
  readonly tolerance?: number;
  /**
   * Hard upper bound on raw body size in bytes; enforced before any
   * crypto runs (DoS guard). Default `1_048_576` (1 MiB).
   */
  readonly maxBodyBytes?: number;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /**
   * Override default error response shaping. Default masks
   * `SIGNATURE_*` / `TIMESTAMP_*` / `REPLAY_*` codes to
   * `'invalid_signature'` to avoid leaking the failure mode.
   */
  readonly onError?: (err: WebhookError) => Response;
  /**
   * Provider-specific extras passed verbatim to the provider's `verify` /
   * `buildSigningString` via the `url` field of `NormalizedRequest`.
   * (Square's `notificationUrl`, etc., should be set on the
   * `NormalizedRequest.url` instead by the adapter.)
   */
  readonly url?: string;
}

/**
 * Handler shape adapters produce. Returns `void` (adapter sends 200) or a
 * `Response` (adapter forwards as-is — useful for replay-cached idempotency).
 */
export type WebhookHandler<TEvent, TCtx = unknown> = (
  event: TEvent,
  ctx: {
    readonly rawBody: Uint8Array;
    readonly idempotencyKey: string | null;
    readonly providerId: string;
    readonly framework: TCtx;
  },
) => Promise<void | Response> | void | Response;
