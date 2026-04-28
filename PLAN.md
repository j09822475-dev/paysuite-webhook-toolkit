# `@paysuite/webhook-toolkit` — Architecture Plan

> Universal, edge-first TypeScript toolkit for receiving webhooks from 20+ providers.
> Zero runtime deps · tree-shakeable providers · pluggable idempotency · framework adapters.

---

## 0. Design Tenets

1. **Edge-first.** All cryptographic primitives use the [Web Crypto API](https://developer.mozilla.org/docs/Web/API/Web_Crypto_API) (`globalThis.crypto.subtle`). No `node:crypto`, no `Buffer`. Runs unchanged on Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, and browsers (test fixtures).
2. **Zero runtime dependencies.** `peerDependencies` for framework adapters only, all marked `optional`.
3. **Tree-shakeable providers.** Each provider lives in its own subpath export (`./providers/stripe`, `./providers/github`, ...). A user importing only Stripe pulls < 2 KB gzipped.
4. **Strict separation of concerns:** verification → parsing → routing → idempotency → side-effects. Each layer is independently usable.
5. **Result-style returns by default; throwing only at API boundaries.** Verification returns a discriminated `VerificationResult`, never throws on a bad signature (that's expected control flow). Misconfiguration (e.g. missing secret) throws synchronously.
6. **Type-safe event router.** Provider modules export branded `Event` discriminated unions; the router uses conditional types to derive handler payloads from `event.type`.
7. **Cross-runtime raw-body handling.** Adapters always feed `Uint8Array` raw bodies into the verifier. Pre-parsed JSON is never trusted for signature verification (the #1 footgun this lib eliminates).
8. **Pluggable everything that touches I/O.** `IdempotencyStore`, `Logger`, `Clock`, `Crypto` are all interfaces with sensible defaults — but always overridable for tests / Redis / KV / D1 / Upstash / DynamoDB.

---

## 1. Project Structure

Exact file tree. Every file is described.

```
paysuite-webhook-toolkit/
├── PLAN.md                              # This document.
├── README.md                            # User-facing docs (quickstart per framework + provider matrix).
├── LICENSE                              # MIT.
├── CHANGELOG.md                         # Keep-a-changelog format.
├── CONTRIBUTING.md                      # How to add a provider plugin.
├── package.json                         # See section 8.
├── tsconfig.json                        # Strict TS, ES2022 target, NodeNext module.
├── tsconfig.build.json                  # Extends tsconfig, emits to dist/, no tests.
├── tsup.config.ts                       # Bundler config: ESM-only, per-entry chunks, .d.ts.
├── vitest.config.ts                     # Test runner config (jsdom-free; node + edge env).
├── .size-limit.json                     # Bundle-size budgets per entry point.
├── .eslintrc.cjs                        # @typescript-eslint strict.
├── .prettierrc                          # Standard formatting.
├── .npmignore                           # Belt-and-braces with package.json `files`.
├── .github/
│   └── workflows/
│       ├── ci.yml                       # lint + typecheck + test (matrix: node 18/20/22, bun, deno).
│       ├── size.yml                     # size-limit on PRs.
│       └── release.yml                  # changesets-based release w/ npm provenance.
│
├── src/
│   ├── index.ts                         # PUBLIC ROOT ENTRY. Re-exports `createVerifier`,
│   │                                    #   core types, and the `defineProvider` helper.
│   │                                    #   Does NOT re-export individual providers
│   │                                    #   (would defeat tree-shaking).
│   │
│   ├── core/
│   │   ├── verifier.ts                  # `createVerifier()` factory. Composes a WebhookProvider
│   │   │                                #   with options into a Verifier with `.verify()`.
│   │   ├── multi-verifier.ts            # `createMultiVerifier()` — single-endpoint dispatch
│   │   │                                #   to one of N child verifiers (§2.8).
│   │   ├── crypto.ts                    # WebCrypto wrappers: `hmacSha256`, `hmacSha1`,
│   │   │                                #   `verifyEd25519`. Returns Uint8Array digests.
│   │   ├── timing-safe.ts               # Constant-time `Uint8Array` equality (XOR-fold).
│   │   ├── encoding.ts                  # `hex`, `base64`, `base64url`, `utf8` ↔ Uint8Array.
│   │   │                                #   Pure JS — no Buffer / atob fallbacks needed.
│   │   ├── headers.ts                   # `HeaderBag` abstraction over Headers / Record /
│   │   │                                #   Node IncomingHttpHeaders. Case-insensitive.
│   │   ├── body.ts                      # `readRawBody(input)` normalizes Request | Buffer |
│   │   │                                #   Uint8Array | ReadableStream | string → Uint8Array.
│   │   ├── replay.ts                    # `enforceTimestampTolerance(ts, now, tolerance)`.
│   │   ├── clock.ts                     # `Clock` interface + default `systemClock`.
│   │   ├── result.ts                    # `Result<T, E>` discriminated union + helpers.
│   │   └── types.ts                     # Core public types: `Provider`, `Verifier`,
│   │                                    #   `VerifiedEvent`, `VerificationOptions`, etc.
│   │
│   ├── errors/
│   │   └── index.ts                     # `WebhookError` base + 8 subclasses + `ErrorCode` enum.
│   │
│   ├── providers/
│   │   ├── index.ts                     # Barrel that re-exports every provider — for users
│   │   │                                #   who explicitly opt out of tree-shaking. Marked
│   │   │                                #   `sideEffects: false` so unused names are dropped.
│   │   ├── _shared/
│   │   │   ├── hmac-provider.ts         # Helper to define HMAC-based providers in <30 LOC.
│   │   │   ├── stripe-style.ts          # Shared parser for Stripe's `t=…,v1=…` scheme.
│   │   │   └── svix-style.ts            # Shared parser for Standard Webhooks (`v1,…`).
│   │   ├── stripe.ts                    # Stripe (`Stripe-Signature`, HMAC-SHA256, t+body).
│   │   ├── github.ts                    # GitHub (`X-Hub-Signature-256`, `X-GitHub-Delivery`).
│   │   ├── shopify.ts                   # Shopify (`X-Shopify-Hmac-Sha256`, base64).
│   │   ├── twilio.ts                    # Twilio (`X-Twilio-Signature`, URL+sorted-params).
│   │   ├── slack.ts                     # Slack (`X-Slack-Signature`, `v0:ts:body`).
│   │   ├── clerk.ts                     # Clerk (Svix format).
│   │   ├── sendgrid.ts                  # SendGrid Event Webhook (Ed25519).
│   │   ├── resend.ts                    # Resend (Svix format).
│   │   ├── linear.ts                    # Linear (`Linear-Signature`, HMAC-SHA256).
│   │   ├── vercel.ts                    # Vercel (`x-vercel-signature`, HMAC-SHA1).
│   │   ├── discord.ts                   # Discord interactions (Ed25519).
│   │   ├── lemon-squeezy.ts             # Lemon Squeezy (`X-Signature`, HMAC-SHA256).
│   │   ├── paddle.ts                    # Paddle Billing (`Paddle-Signature`, ts + body).
│   │   ├── square.ts                    # Square (`x-square-hmacsha256-signature` + URL).
│   │   ├── mailgun.ts                   # Mailgun (`timestamp + token` HMAC-SHA256).
│   │   ├── postmark.ts                  # Postmark (Basic-auth-style; provider returns shared
│   │   │                                #   secret check helper, not crypto).
│   │   └── svix.ts                      # Standard Webhooks / Svix (`webhook-id`, `webhook-timestamp`,
│   │                                    #   `webhook-signature`).
│   │
│   ├── router/
│   │   ├── index.ts                     # `createRouter()` builder + `.handle()`.
│   │   ├── types.ts                     # `EventMap`, `RouterHandler`, conditional resolution.
│   │   └── dispatch.ts                  # Internal: handler resolution + middleware chain.
│   │
│   ├── idempotency/
│   │   ├── index.ts                     # `withIdempotency()` middleware factory + public types.
│   │   ├── memory.ts                    # In-memory store (Map + TTL sweep). Default.
│   │   ├── key.ts                       # Default idempotency-key extractor (provider-aware).
│   │   └── types.ts                     # `IdempotencyStore`, `IdempotencyRecord`.
│   │
│   ├── retry/
│   │   └── index.ts                     # `extractRetryMetadata(provider, headers)` —
│   │                                    #   normalizes `Stripe-Webhook-Retry`, `X-GitHub-Delivery`
│   │                                    #   redelivery flag, `Svix-Id`+attempt count, etc.
│   │
│   ├── adapters/
│   │   ├── _shared/
│   │   │   └── normalize.ts             # `toRequest()` / `fromRequest()` helpers reused
│   │   │                                #   across framework adapters.
│   │   ├── fetch.ts                     # `createFetchHandler(verifier, handler)` →
│   │   │                                #   `(req: Request) => Promise<Response>`.
│   │   ├── express.ts                   # `expressWebhook(verifier, handler)` →
│   │   │                                #   `RequestHandler`. Requires `express.raw()`.
│   │   ├── fastify.ts                   # `fastifyWebhookPlugin(...)` — registers raw-body
│   │   │                                #   parser scoped to webhook route.
│   │   ├── hono.ts                      # `honoWebhook(verifier, handler)` middleware.
│   │   ├── elysia.ts                    # `elysiaWebhookPlugin(...)`.
│   │   ├── next-app.ts                  # `nextAppWebhook(verifier, handler)` →
│   │   │                                #   route handler. Sets `runtime: 'edge'` compatible.
│   │   └── next-pages.ts                # `nextPagesWebhook(...)` — disables bodyParser, uses
│   │                                    #   IncomingMessage stream.
│   │
│   ├── testing/
│   │   ├── index.ts                     # Public testing surface.
│   │   ├── sign.ts                      # `signWith(provider, { secret, payload, ts })` →
│   │   │                                #   Returns headers + body for use in tests.
│   │   ├── fixtures.ts                  # Sample payloads per provider (for snapshot tests).
│   │   ├── memory-store.ts              # Re-exported in-memory IdempotencyStore for tests.
│   │   └── fake-clock.ts                # Deterministic Clock for replay-tolerance tests.
│   │
│   └── logger/
│       ├── index.ts                     # `Logger` interface + `noopLogger` + `consoleLogger`.
│       └── pino.ts                      # Optional pino-compatible adapter (no `pino` dep —
│                                        #   only typed shape match).
│
├── tests/
│   ├── core/
│   │   ├── verifier.test.ts
│   │   ├── crypto.test.ts
│   │   ├── timing-safe.test.ts
│   │   ├── encoding.test.ts
│   │   └── replay.test.ts
│   ├── providers/                       # One file per provider; uses official fixtures
│   │   ├── stripe.test.ts               #   from each provider's docs / SDK test suite.
│   │   ├── github.test.ts
│   │   ├── shopify.test.ts
│   │   └── ...                          # (one per provider)
│   ├── router/
│   │   └── router.test.ts
│   ├── idempotency/
│   │   ├── memory-store.test.ts
│   │   └── middleware.test.ts
│   ├── adapters/
│   │   ├── fetch.test.ts
│   │   ├── express.test.ts              # supertest-driven.
│   │   ├── fastify.test.ts
│   │   ├── hono.test.ts
│   │   └── next-app.test.ts
│   ├── e2e/
│   │   └── multi-provider.test.ts       # Single endpoint serving 5 providers.
│   ├── runtimes/
│   │   ├── node.test.ts
│   │   ├── bun.test.ts                  # Skipped if `Bun` undefined.
│   │   ├── deno.test.ts                 # Skipped if `Deno` undefined.
│   │   └── workers.test.ts              # Miniflare-driven.
│   └── tsd/
│       └── types.test-d.ts              # Type-level tests via `expect-type`.
│
├── examples/
│   ├── nextjs-app-router/               # Single endpoint accepting Stripe + Clerk + GitHub.
│   ├── hono-cloudflare-workers/         # Hono on CF Workers w/ KV idempotency.
│   ├── express/                         # Classic Express w/ raw body.
│   ├── elysia-bun/                      # Elysia on Bun.
│   └── fastify/                         # Fastify with Redis idempotency store.
│
└── benchmarks/
    └── verify.bench.ts                  # vitest bench: throughput per provider per runtime.
```

---

## 2. Public API Design

### 2.1 Root entry: `@paysuite/webhook-toolkit`

```ts
/**
 * Create a {@link Verifier} for a single provider.
 *
 * The returned verifier is a stateless, runtime-agnostic object that
 * inspects an incoming request, validates its signature against the
 * configured secret, optionally enforces a timestamp-tolerance window
 * to prevent replay attacks, and returns a discriminated
 * {@link VerificationResult}.
 *
 * @typeParam P - A {@link WebhookProvider} definition (e.g. `typeof stripe`).
 *                The verifier's `event` payload is inferred from `P`.
 *
 * @param options.provider     The provider plugin (`stripe`, `github`, …).
 * @param options.secret       Provider signing secret(s). **Required.**
 *                             Pass a single secret OR an `Array<string | Uint8Array>`
 *                             to support **zero-downtime key rotation** —
 *                             every entry is tried with timing-safe equality
 *                             and the request verifies if **any** match.
 *                             Throws `ConfigError` (code: `CONFIG`) if missing
 *                             or empty. For Ed25519 providers, pass the
 *                             provider's public key (raw 32-byte hex/base64
 *                             or PEM). See §9.2 for the rotation playbook.
 * @param options.tolerance    Replay-window in seconds. Defaults to `300`
 *                             (5 min, matching Stripe). Pass `Infinity` to
 *                             disable. Ignored for providers that do not
 *                             include a timestamp.
 * @param options.maxBodyBytes Hard upper bound on raw body size in bytes
 *                             enforced **before** any crypto work runs
 *                             (DoS guard). Default `1_048_576` (1 MiB).
 *                             See §9.1.4.
 * @param options.clock        Override `Date.now()` source. Used in tests.
 * @param options.logger       Optional structured logger. Receives
 *                             `verify.ok`, `verify.fail`, `verify.replay`
 *                             events with redacted metadata.
 * @param options.metrics      Optional metrics sink (counter increments).
 *                             Default: noop. Library emits `verify.ok`,
 *                             `verify.fail`, `replay.exceeded`,
 *                             `idempotency.duplicate`, `idempotency.store_error`
 *                             with `{ providerId, code? }` tags. Wire to
 *                             OTel/Prometheus/Datadog with a thin shim.
 *
 * @returns A {@link Verifier} with `.verify(input)` and `.providerId`.
 *
 * @throws {WebhookError} (code `CONFIG`) if `secret` / `provider` is missing or invalid.
 *
 * @example
 * ```ts
 * import { createVerifier } from '@paysuite/webhook-toolkit';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const verifier = createVerifier({
 *   provider: stripe,
 *   secret: process.env.STRIPE_WEBHOOK_SECRET!,
 * });
 *
 * export async function POST(req: Request) {
 *   const result = await verifier.verify(req);
 *   if (!result.ok) {
 *     return new Response(result.error.message, { status: result.error.httpStatus });
 *   }
 *   // result.event is typed as Stripe's discriminated event union:
 *   if (result.event.type === 'payment_intent.succeeded') {
 *     // result.event.data.object is fully typed.
 *   }
 *   return new Response('ok');
 * }
 * ```
 */
export function createVerifier<P extends WebhookProvider>(
  options: VerifierOptions<P>,
): Verifier<P>;

/**
 * Define a custom provider plugin. Use when integrating a provider
 * not yet shipped in this library, or for in-house webhook formats.
 *
 * The provider is a **strategy of small pure functions** — the verifier
 * in `core/` orchestrates them and applies canonical timing-safe equality
 * and replay-window enforcement. Providers never call `Date.now()` or
 * compare bytes themselves.
 *
 * @example
 * ```ts
 * import { defineWebhookProvider } from '@paysuite/webhook-toolkit';
 *
 * export const myCorpProvider = defineWebhookProvider({
 *   id: 'mycorp',
 *   algorithm: 'HMAC-SHA256',
 *   parseSignature: (headers) => {
 *     const raw = headers.get('x-mycorp-signature');
 *     return raw ? { signatures: [hex.decode(raw)] } : null;
 *   },
 *   extractTimestamp: (headers) => {
 *     const ts = headers.get('x-mycorp-timestamp');
 *     return ts ? Number(ts) * 1000 : null;
 *   },
 *   buildSigningString: ({ rawBody, timestamp }) =>
 *     utf8.encode(`${timestamp}.`).concat(rawBody),
 *   parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)),
 *   idempotencyKey: (_input, event) => event.id ?? null,
 * });
 * ```
 */
export function defineWebhookProvider<TEvent = unknown>(
  spec: WebhookProviderSpec<TEvent>,
): WebhookProvider<TEvent>;

/** @deprecated Alias of {@link defineWebhookProvider}. Kept for shorter call sites; not the canonical name. */
export const defineProvider: typeof defineWebhookProvider;

// Re-exported types
export type {
  WebhookProvider,
  WebhookProviderSpec,
  Verifier,
  VerifierOptions,
  VerificationResult,
  VerifiedEvent,
  HeaderBag,
  RawBodyInput,
  Clock,
  Logger,
  Metrics,
} from './core/types';
```

### 2.2 Provider plugin shape

A `WebhookProvider` is a **strategy of small pure functions**, not a black
box. The verifier in `core/verifier.ts` orchestrates these methods and
performs the security-sensitive steps itself — timing-safe equality,
replay-window enforcement, body-size limits, secret-array iteration. This
guarantees those primitives are canonical, audited once, and identical
across every provider; no provider can accidentally weaken them.

```ts
/**
 * A WebhookProvider describes how to verify a single vendor's webhook
 * format. Plugins are pure data + small functions — they hold no state,
 * never touch `Date.now()`, never compare bytes, never decide whether
 * a signature is "good" (the core verifier does that).
 *
 * The four methods below correspond to the data flow in §3.2.
 */
export interface WebhookProvider<TEvent = unknown> {
  /** Stable identifier — used in logs, metrics, and the typed router. */
  readonly id: string;

  /**
   * Algorithm tag used for telemetry / logs only.
   * `'HMAC-SHA256' | 'HMAC-SHA1' | 'Ed25519'`.
   *
   * NOTE: control flow is NOT driven from this field — the choice of
   * crypto primitive is implicit in `buildSigningString` + which
   * `core/crypto.ts` helper the provider invokes internally. This field
   * is metadata, surfaced in `Logger`/`Metrics` tags only.
   */
  readonly algorithm: SignatureAlgorithm;

  /**
   * Step 1 — extract the candidate signature(s) from headers.
   *
   * Returns `null` when the required header is absent, which the verifier
   * surfaces as `WebhookError(code: 'SIGNATURE_MISSING')`. Returning a
   * malformed (e.g. non-hex) value is also acceptable; the verifier maps
   * decode failures to `'SIGNATURE_MALFORMED'`.
   *
   * Multiple `signatures[]` covers Stripe's `t=…,v1=A,v1=B,v0=…` rotation
   * scheme (see §9.2 item 8) — the verifier tries every entry.
   */
  readonly parseSignature: (
    headers: HeaderBag,
  ) => { signatures: Uint8Array[]; raw: string } | null;

  /**
   * Step 2 — extract the request timestamp in **epoch milliseconds**.
   *
   * Return `null` for providers that do not sign a timestamp (Shopify,
   * GitHub-classic). The verifier then skips replay-window enforcement
   * but still emits a single `replay.unsupported` log/metric per process
   * (see §9.4 item 17).
   *
   * Providers that store the timestamp in the body (Mailgun) read it
   * here from the raw bytes after a single JSON parse — never from a
   * pre-decoded representation.
   */
  readonly extractTimestamp: (
    headers: HeaderBag,
    rawBody: Uint8Array,
  ) => number | null;

  /**
   * Step 3 — build the exact byte sequence the provider HMAC'd.
   *
   * MUST be deterministic and reversible from `(rawBody, timestamp, url,
   * method)`. The verifier feeds the result to the appropriate WebCrypto
   * primitive once per secret in the `secret` array.
   */
  readonly buildSigningString: (input: {
    rawBody: Uint8Array;
    timestamp: number | null;
    url: string;
    method: string;
  }) => Uint8Array;

  /**
   * Step 4 — parse the verified raw body into the typed event union.
   *
   * Runs **only after** the signature has been validated. Throws / returns
   * a parse error for malformed JSON; never re-stringifies (would break
   * idempotency keys derived from the canonical bytes).
   */
  readonly parseEvent: (rawBody: Uint8Array) => TEvent;

  /**
   * Optional — provider-specific idempotency key. Stripe returns
   * `event.id`, GitHub returns `X-GitHub-Delivery`, Svix returns
   * `webhook-id`. The verifier namespaces it as `${providerId}:${key}`
   * before handing to the store.
   */
  readonly idempotencyKey?: (
    input: NormalizedRequest,
    event: TEvent,
  ) => string | null;

  /** Phantom marker — preserves the event union through generic inference. */
  readonly __eventMarker?: TEvent;
}

/** Public spec passed to `defineWebhookProvider`; structurally identical to {@link WebhookProvider}. */
export type WebhookProviderSpec<TEvent = unknown> = WebhookProvider<TEvent>;

/** @deprecated Use {@link WebhookProvider}. Internal alias retained for terseness. */
export type Provider<TEvent = unknown> = WebhookProvider<TEvent>;
```

### 2.3 Verifier surface

```ts
export interface Verifier<P extends WebhookProvider> {
  readonly providerId: string;

  /**
   * Verify any of these inputs:
   *  - `Request` (Web Standard / fetch / Hono / Next App Router)
   *  - `IncomingMessage` (Node http) — body must be `Buffer`/string buffered
   *  - `{ headers, rawBody }` plain object — escape hatch for any framework
   *
   * Always returns a `VerificationResult` — never throws on bad input.
   */
  verify(
    input: VerifierInput,
  ): Promise<VerificationResult<EventOf<P>>>;
}

export type VerificationResult<TEvent> =
  | { ok: true; event: TEvent; rawBody: Uint8Array; idempotencyKey: string | null; receivedAt: number }
  | { ok: false; error: WebhookError };
```

### 2.4 Typed event router

```ts
/**
 * Build a fluent, type-safe router over a provider's discriminated event
 * union. Adding `.on('foo.bar', handler)` narrows `event` inside `handler`
 * to exactly the `foo.bar` variant.
 *
 * @example
 * ```ts
 * import { createRouter } from '@paysuite/webhook-toolkit/router';
 * import type { StripeEvent } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const router = createRouter<StripeEvent>()
 *   .on('payment_intent.succeeded', async (e) => {
 *     // e.data.object is typed as Stripe.PaymentIntent
 *     await markPaid(e.data.object.id);
 *   })
 *   .on('charge.refunded', async (e) => { … })
 *   .fallback(async (e) => log.warn('unhandled', { type: e.type }));
 *
 * await router.handle(verified.event);
 * ```
 *
 * Naming note: the catch-all is `.fallback()` (matches Hono's
 * middleware idiom and pairs naturally with `.on()`). It is **not**
 * `.otherwise()` (ts-pattern-ish) or `.default()` (collides with the
 * default-export keyword in editor autocomplete).
 */
export function createRouter<TEvent extends { type: string }>(): Router<TEvent>;

export interface Router<TEvent extends { type: string }, THandled extends string = never> {
  on<TType extends Exclude<TEvent['type'], THandled>>(
    type: TType,
    handler: (event: Extract<TEvent, { type: TType }>) => Promise<void> | void,
  ): Router<TEvent, THandled | TType>;

  /** Catch-all for any event type not yet matched by `.on(...)`. */
  fallback(
    handler: (event: Exclude<TEvent, { type: THandled }>) => Promise<void> | void,
  ): Router<TEvent, TEvent['type']>;

  handle(event: TEvent): Promise<void>;
}
```

### 2.5 Idempotency middleware

```ts
/**
 * Wrap a `Verifier` so that previously-seen webhook IDs are not processed
 * twice. The store interface is intentionally minimal so that any
 * Map/Redis/KV/D1/Upstash/DynamoDB backend can be plugged in.
 *
 * `onDuplicate` controls what happens when a key has already been seen.
 * **The default is `'skip'`**, which is the only safe choice for production:
 * ack the request as 200 so the provider does not re-trigger exponential
 * retries (Stripe/Svix retry on any non-2xx). Returning 409 by default
 * would create a retry storm for events the system already processed —
 * the entire reason idempotency exists. Reserve 409 for `'error'` mode,
 * which is intended for environments where duplicates indicate a bug
 * the operator wants surfaced.
 *
 * @example
 * ```ts
 * import { createVerifier } from '@paysuite/webhook-toolkit';
 * import { withIdempotency, memoryStore } from '@paysuite/webhook-toolkit/idempotency';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const base = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });
 * const verifier = withIdempotency(base, {
 *   store: memoryStore({ ttlSeconds: 86400 }),
 *   // onDuplicate defaults to 'skip' — omit unless you specifically need another mode.
 * });
 * ```
 */
export function withIdempotency<P extends WebhookProvider>(
  verifier: Verifier<P>,
  options: IdempotencyOptions,
): Verifier<P>;

export interface IdempotencyOptions {
  store: IdempotencyStore;
  ttlSeconds?: number;          // default 86_400 (24 h)
  /**
   * Behavior when a duplicate key is seen.
   *
   * - `'skip'` (**default**) — return `{ ok: false, error: WebhookError(IDEMPOTENCY_DUPLICATE, httpStatus: 200) }`.
   *   Adapters ack with 200 so the provider stops retrying. Handler is NOT invoked.
   * - `'replay-cached'` — return the cached result body (requires `saveResult`/`getResult` on the store), httpStatus 200.
   * - `'error'` — return `{ ok: false, error: WebhookError(IDEMPOTENCY_DUPLICATE, httpStatus: 409) }`.
   *   Use only if duplicates indicate a programmer bug worth surfacing.
   */
  onDuplicate?: 'skip' | 'replay-cached' | 'error';
}

export interface IdempotencyStore {
  /** Returns `true` if the key was newly inserted (i.e. NOT a duplicate). MUST be atomic across replicas (see §9.5 item 19). */
  putIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
  /** Optional — stores a cached response body keyed by idempotency key. */
  saveResult?(key: string, value: Uint8Array, ttlSeconds: number): Promise<void>;
  getResult?(key: string): Promise<Uint8Array | null>;
}
```

### 2.6 Framework adapters

```ts
// ---------- Web Standard fetch ----------
import { createFetchHandler } from '@paysuite/webhook-toolkit/adapters/fetch';
export default createFetchHandler(verifier, async (event, ctx) => { … });

// ---------- Express ----------
import express from 'express';
import { expressWebhook } from '@paysuite/webhook-toolkit/adapters/express';
const app = express();
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),    // raw body required
  expressWebhook(verifier, async (event) => { … }),
);

// ---------- Hono ----------
import { Hono } from 'hono';
import { honoWebhook } from '@paysuite/webhook-toolkit/adapters/hono';
const app = new Hono();
app.post('/webhooks/stripe', honoWebhook(verifier, async (event, c) => { … }));

// ---------- Next.js App Router ----------
import { nextAppWebhook } from '@paysuite/webhook-toolkit/adapters/next-app';
export const POST = nextAppWebhook(verifier, async (event) => { … });
export const runtime = 'edge';   // works unchanged

// ---------- Fastify ----------
import { fastifyWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/fastify';
fastify.register(fastifyWebhookPlugin, {
  path: '/webhooks/stripe', verifier, handler: async (event) => { … },
});

// ---------- Elysia ----------
import { elysiaWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/elysia';
new Elysia().use(elysiaWebhookPlugin({ verifier, path: '/webhooks/stripe', handler }));
```

Each adapter signature normalizes to a single shape internally:

```ts
type WebhookHandler<TEvent, TCtx = unknown> = (
  event: TEvent,
  ctx: { rawBody: Uint8Array; idempotencyKey: string | null; framework: TCtx },
) => Promise<void | Response> | void | Response;
```

### 2.7 Provider modules — example: `./providers/stripe`

```ts
import type { WebhookProvider } from '@paysuite/webhook-toolkit';
import { stripeStyleSignature } from '../_shared/stripe-style';
import { hex, utf8 } from '../../core/encoding';

/**
 * Stripe-shaped event. Discriminated by `type`. Library ships a curated
 * subset of common types; users may augment via declaration merging.
 */
export type StripeEvent =
  | { type: 'payment_intent.succeeded'; id: string; data: { object: PaymentIntent } }
  | { type: 'payment_intent.payment_failed'; id: string; data: { object: PaymentIntent } }
  | { type: 'charge.refunded'; id: string; data: { object: Charge } }
  | { type: 'checkout.session.completed'; id: string; data: { object: CheckoutSession } }
  // … ~30 most common events shipped; rest fall through generic shape:
  | { type: string; id: string; data: { object: Record<string, unknown> } };

/**
 * Stripe Provider. Implements the `WebhookProvider` strategy contract:
 * `parseSignature` extracts every `v1=…` from `Stripe-Signature` (so the
 * core verifier can iterate them × the secret array for rotation),
 * `extractTimestamp` reads `t=…` (seconds → ms), `buildSigningString`
 * concatenates `t.body`, and `parseEvent` JSON-decodes the verified bytes.
 * The core verifier owns all timing-safe / replay / size-limit checks.
 */
export const stripe: WebhookProvider<StripeEvent> = {
  id: 'stripe',
  algorithm: 'HMAC-SHA256',                          // for telemetry only

  parseSignature: (headers) => {
    const raw = headers.get('stripe-signature');
    if (!raw) return null;
    const parts = stripeStyleSignature.parse(raw);   // { t, v1: hex[], v0?: hex[] }
    return parts.v1.length
      ? { signatures: parts.v1.map(hex.decode), raw }
      : null;
  },

  extractTimestamp: (headers) => {
    const raw = headers.get('stripe-signature');
    if (!raw) return null;
    const t = stripeStyleSignature.parse(raw).t;
    return Number.isFinite(t) ? t * 1000 : null;
  },

  buildSigningString: ({ rawBody, timestamp }) => {
    const tsBytes = utf8.encode(`${Math.floor((timestamp ?? 0) / 1000)}.`);
    const out = new Uint8Array(tsBytes.length + rawBody.length);
    out.set(tsBytes, 0);
    out.set(rawBody, tsBytes.length);
    return out;
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as StripeEvent,

  idempotencyKey: (_input, event) => event.id ?? null,
};
```

### 2.8 Multi-provider single-endpoint dispatch

The report's primary use case ("один сервис принимает события от Stripe,
Clerk, GitHub, Shopify" — *"Очень часто — основной use case в современных
SaaS"*) is multi-provider ingestion behind one URL. Forcing users to roll
their own URL/header dispatch defeats the multi-provider thesis vs
`@octokit/webhooks` (single-vendor), so the v0.1 surface ships a tiny
`createMultiVerifier` helper.

```ts
/**
 * Compose several Verifiers into a single dispatching Verifier.
 *
 * The dispatcher inspects the request and picks **one** child verifier;
 * dispatch is by URL path segment by default (e.g. `/webhooks/stripe`
 * → `verifiers.stripe`), or by a user-supplied function.
 *
 * The result is itself a `Verifier`, so it composes with `withIdempotency`,
 * the framework adapters, and the typed router (using a discriminated
 * union of all child events).
 *
 * @example
 * ```ts
 * import { createVerifier, createMultiVerifier } from '@paysuite/webhook-toolkit';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 * import { github } from '@paysuite/webhook-toolkit/providers/github';
 * import { clerk } from '@paysuite/webhook-toolkit/providers/clerk';
 *
 * const multi = createMultiVerifier({
 *   stripe: createVerifier({ provider: stripe, secret: env.STRIPE_SECRET }),
 *   github: createVerifier({ provider: github, secret: env.GH_SECRET }),
 *   clerk:  createVerifier({ provider: clerk,  secret: env.CLERK_SECRET }),
 * }, {
 *   dispatch: 'by-path',  // /webhooks/stripe → 'stripe', etc.
 * });
 *
 * export const POST = nextAppWebhook(multi, async (event, ctx) => {
 *   // event is a discriminated union: StripeEvent | GitHubEvent | ClerkEvent
 *   // ctx.providerId tells you which one it is.
 * });
 * ```
 */
export function createMultiVerifier<
  TVerifiers extends Record<string, Verifier<WebhookProvider>>,
>(
  verifiers: TVerifiers,
  options?: MultiVerifierOptions<TVerifiers>,
): Verifier<WebhookProvider<EventOf<TVerifiers[keyof TVerifiers]['__providerMarker']>>>;

export interface MultiVerifierOptions<TVerifiers extends Record<string, unknown>> {
  /**
   * - `'by-path'` (default) — last URL path segment must match a key in `verifiers`.
   * - `'by-header'` — `x-webhook-provider` header.
   * - function — full request inspection; return the chosen key (or `null` → `SignatureMissingError`).
   */
  dispatch?: 'by-path' | 'by-header' | ((req: NormalizedRequest) => keyof TVerifiers | null);
  /** Custom header name when `dispatch === 'by-header'`. Default `'x-webhook-provider'`. */
  headerName?: string;
}
```

Implementation is ~40 LOC; lives at `src/core/multi-verifier.ts`.

### 2.9 Testing utilities

```ts
import { signWith } from '@paysuite/webhook-toolkit/testing';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';

const { headers, rawBody } = await signWith(stripe, {
  secret: 'whsec_test',
  payload: { type: 'payment_intent.succeeded', id: 'evt_1', data: { object: { id: 'pi_1' } } },
  timestamp: 1714200000,
});
// → use `headers` + `rawBody` to drive supertest / msw / vitest.
```

---

## 3. Internal Architecture

### 3.1 Module dependency graph

```
                          ┌──────────────────────┐
                          │   src/index.ts       │
                          │   (public root)      │
                          └──────────┬───────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ▼                    ▼                    ▼
        ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
        │ core/       │      │ errors/     │      │ logger/     │
        │ verifier.ts │◀────▶│ index.ts    │◀────▶│ index.ts    │
        └─────┬───────┘      └─────────────┘      └─────────────┘
              │
   ┌──────────┼──────────────┬─────────────┬─────────────┐
   ▼          ▼              ▼             ▼             ▼
┌────────┐ ┌────────┐ ┌─────────────┐ ┌────────┐ ┌──────────┐
│crypto  │ │timing- │ │ encoding /  │ │headers │ │ body /   │
│.ts     │ │safe.ts │ │ replay /    │ │.ts     │ │ result   │
└────────┘ └────────┘ │ clock       │ └────────┘ └──────────┘
                      └─────────────┘
                            ▲
                            │ used by every provider
                            │
                  ┌─────────┴─────────┐
                  │  providers/*      │ ── tree-shakeable, one entry each
                  │  + _shared/*      │
                  └─────────┬─────────┘
                            │
                ┌───────────┼────────────┬───────────┐
                ▼           ▼            ▼           ▼
            ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐
            │router/ │ │idempot- │ │ retry/   │ │testing/  │
            │        │ │ ency/   │ │          │ │          │
            └────────┘ └─────────┘ └──────────┘ └──────────┘
                            ▲
                            │
                      ┌─────┴───────┐
                      │ adapters/*  │ ── consumes a Verifier; framework-specific
                      └─────────────┘
```

**Hard rules enforced via ESLint `no-restricted-imports`:**

- `core/*` MUST NOT import from `providers/`, `adapters/`, `router/`, `idempotency/`, `testing/`.
- `providers/*` MUST NOT import from `adapters/`, `router/`, `idempotency/`.
- `adapters/*` MUST NOT import provider-specific code; only `core/` and the `Verifier` interface.
- `testing/*` MAY import from anywhere (it's a kitchen sink).

### 3.2 Data flow — inbound webhook

```
HTTP request (any runtime)
        │
        ▼
adapter (e.g. expressWebhook)
        │   normalizes to { headers: HeaderBag, rawBody: Uint8Array, url, method }
        ▼
Verifier.verify(NormalizedRequest)
        │
        ├── 1. Provider.parseSignature(headers)         → { algorithm, signatures[], timestamp? }
        │      → fail-fast: SignatureMissingError, SignatureMalformedError
        │
        ├── 2. enforceTimestampTolerance(ts, clock.now(), tolerance)
        │      → ReplayWindowExceededError
        │
        ├── 3. Provider.buildSigningString({ rawBody, timestamp, url, method })
        │      → Uint8Array
        │
        ├── 4. crypto.hmacSha256(secret, signingString) OR verifyEd25519(...)
        │      → digest: Uint8Array
        │
        ├── 5. timingSafeEqual(digest, expected)        → SignatureMismatchError
        │
        ├── 6. Provider.parseEvent(rawBody)             → ParseError
        │
        └── 7. return { ok: true, event, rawBody, idempotencyKey, receivedAt }
                        │
                        ▼
                user handler (or router, or idempotency wrapper)
```

### 3.3 Key design patterns

| Pattern | Where | Why |
|---|---|---|
| **Plugin / Strategy** | `Provider` interface | Adding a new vendor is a single file with no core changes. |
| **Result-as-data** | `VerificationResult` | Bad signatures are control flow, not exceptions. Allows fast paths in adapters. |
| **Dependency injection** | `Clock`, `Logger`, `IdempotencyStore` | Deterministic tests, swap for Redis/KV in prod. |
| **Phantom types** | `Provider<TEvent>` | Carries event union through `createVerifier` without runtime cost. |
| **Builder w/ accumulating types** | `Router` | Each `.on()` removes the handled type from `THandled`, enabling exhaustiveness checks. |
| **Decorator** | `withIdempotency(verifier)` | Wraps a Verifier transparently — same interface in/out. |
| **Adapter** | `adapters/*` | Translates framework idioms to a single normalized contract. |
| **Sans-I/O core** | `core/` | All I/O lives in adapters & stores; core is a pure function library. |

---

## 4. Type System

### 4.1 Core types

```ts
export type SignatureAlgorithm = 'HMAC-SHA256' | 'HMAC-SHA1' | 'Ed25519';

export type RawBodyInput =
  | Uint8Array
  | ArrayBuffer
  | string                 // assumed UTF-8
  | ReadableStream<Uint8Array>;

export interface HeaderBag {
  get(name: string): string | null;       // case-insensitive
  has(name: string): boolean;
  entries(): IterableIterator<[string, string]>;
}

export interface NormalizedRequest {
  readonly headers: HeaderBag;
  readonly rawBody: Uint8Array;            // already buffered
  readonly url: string;                    // full URL (Twilio uses it in signing)
  readonly method: string;
}

export type VerifierInput =
  | Request
  | { headers: HeadersInit | Record<string, string | string[] | undefined>; rawBody: RawBodyInput; url?: string; method?: string };

export interface Clock {
  now(): number;                            // epoch ms
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

### 4.2 Result helper

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const Ok  = <T>(value: T): Result<T, never>  => ({ ok: true,  value });
export const Err = <E>(error: E): Result<never, E>  => ({ ok: false, error });
```

### 4.3 Generic provider preservation

```ts
export interface VerifierOptions<P extends WebhookProvider> {
  provider: P;
  /**
   * Single secret OR an array of secrets. The array form is the
   * **zero-downtime key rotation** path: provide the new secret first
   * and the old one second; the verifier tries each with timing-safe
   * equality and accepts if any match. Drop the old entry once the
   * provider has fully rotated. See §9.2 item 8.
   *
   * Without this, rotating Stripe's two-active-secrets window would
   * require a process restart — a real pain point vs `standardwebhooks`.
   */
  secret: string | Uint8Array | Array<string | Uint8Array>;
  /** Replay tolerance in seconds. Default 300. `Infinity` disables. */
  tolerance?: number;
  /**
   * Hard upper bound on raw body size in bytes, enforced before crypto runs (DoS guard).
   * Default `1_048_576` (1 MiB). See §9.1 item 4.
   */
  maxBodyBytes?: number;
  clock?: Clock;
  logger?: Logger;
  /**
   * Metrics sink. Default: noop. Library increments these counters with
   * `{ providerId, code? }` tags:
   *  - `verify.ok`              — successful verification
   *  - `verify.fail`            — any verification failure (use `code` to discriminate)
   *  - `replay.exceeded`        — timestamp outside tolerance
   *  - `idempotency.duplicate`  — emitted by `withIdempotency`
   *  - `idempotency.store_error`— store unavailable
   * Wire to OTel/Datadog/Prometheus with a thin shim; the OTel adapter
   * in Appendix B is then ~10 LOC.
   */
  metrics?: Metrics;
  /**
   * Override default error response shaping. See §5.4. Default masks all
   * `SIGNATURE_*`/`TIMESTAMP_*`/`REPLAY_*` codes to `'invalid_signature'`
   * to avoid leaking the failure mode to probing attackers.
   */
  onError?: (err: WebhookError) => Response;
}

export interface Metrics {
  increment(name: string, tags?: Record<string, string>): void;
}

// Extracts the event payload type from a WebhookProvider.
export type EventOf<P extends WebhookProvider> =
  P extends WebhookProvider<infer TEvent> ? TEvent : never;
```

### 4.4 Conditional event narrowing in the router

```ts
type OnlyType<TEvent extends { type: string }, TType extends TEvent['type']> =
  Extract<TEvent, { type: TType }>;

// `.on<TType>(type, handler)` narrows TType against the *unused* union remainder.
type RemainingTypes<TEvent extends { type: string }, THandled extends string> =
  Exclude<TEvent['type'], THandled>;
```

This guarantees:
- `router.on('foo', …)` then `router.on('foo', …)` is a **type error** (already handled).
- `router.fallback(handler)` requires `Exclude<TEvent, { type: THandled }>` — exhaustive narrowing.
- Mistyped event names are rejected at compile time.

### 4.5 Compile-time enforcement summary

| Concern | Mechanism |
|---|---|
| WebhookProvider preserves event union | Phantom `__eventMarker` field + `EventOf<P>` |
| Verifier output is provider-specific | Generic propagation through `createVerifier<P>` |
| Router exhaustiveness | Accumulating `THandled` type parameter |
| Secret can't be confused with a public key | Branded type `SigningSecret`/`PublicKey` (opt-in via `signingSecret(...)`) |
| Idempotency store contract | `IdempotencyStore` interface + `vitest tsd` tests |
| Adapter handler shape | Single `WebhookHandler<TEvent>` generic, reused everywhere |

---

## 5. Error Handling Strategy

### 5.1 Single `WebhookError` class with `code` discriminant

The library ships **one** error class; failure modes are discriminated by
the `code` string literal. Avoiding a subclass tree keeps `errors/` under
budget (~80–100 B per class adds up fast), removes the `instanceof`-
across-module-boundaries footgun (multiple bundle copies break it
silently), and matches how users typically branch — on `error.code`,
not `error instanceof X`.

```ts
export class WebhookError extends Error {
  /** Discriminant. Always check this, not `instanceof` subclasses. */
  readonly code: ErrorCode;
  /** Recommended HTTP status to return to the provider. */
  readonly httpStatus: number;
  /** Provider id (for logs / metrics). `''` for `CONFIG` errors thrown before a provider is bound. */
  readonly providerId: string;
  /** Structured metadata; never contains secrets/raw bodies. */
  readonly meta: Record<string, unknown>;

  constructor(args: {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    providerId?: string;
    meta?: Record<string, unknown>;
    cause?: unknown;
  });
}
```

### 5.2 `ErrorCode` enum (string literal union)

```ts
export type ErrorCode =
  | 'CONFIG'                  // 500 — thrown synchronously, never returned
  | 'SIGNATURE_MISSING'       // 400
  | 'SIGNATURE_MALFORMED'     // 400
  | 'SIGNATURE_MISMATCH'      // 401
  | 'TIMESTAMP_MISSING'       // 400
  | 'TIMESTAMP_INVALID'       // 400
  | 'REPLAY_WINDOW_EXCEEDED'  // 400
  | 'PAYLOAD_PARSE'           // 400
  | 'PAYLOAD_TOO_LARGE'       // 413 — `maxBodyBytes` exceeded
  | 'UNSUPPORTED_ALGORITHM'   // 500
  | 'IDEMPOTENCY_DUPLICATE'   // 200 in 'skip' (default), 409 in 'error' mode
  | 'IDEMPOTENCY_STORE';      // 503 — store unavailable
```

### 5.3 Throw vs Return — the rule

| Situation | Behavior | Rationale |
|---|---|---|
| Verification failure (bad sig, replay, malformed payload) | **Return** `{ ok: false, error }` | Expected control flow — always returned, never thrown. Adapter maps to HTTP. |
| Programmer misconfiguration (missing secret, unknown algorithm, bad provider) | **Throw** `WebhookError(code: 'CONFIG')` synchronously from `createVerifier` | Bug, not runtime input. Failing loudly at boot is correct. |
| Unexpected runtime fault (Web Crypto unavailable, store down) | **Throw** | Truly exceptional; the adapter's outer `try/catch` handles → 5xx. |
| Duplicate detected by idempotency wrapper | **Return** `{ ok: false, error: WebhookError(code: 'IDEMPOTENCY_DUPLICATE') }` with `httpStatus: 200` | The default `'skip'` mode acks 200 so the provider stops retrying (otherwise we re-trigger Stripe/Svix exponential retries — the entire point of idempotency). 409 is reserved for `'error'` mode for ops who want duplicates surfaced loudly. |

### 5.4 Adapter ↔ HTTP mapping

Adapters apply this default mapping (overridable via `VerifierOptions.onError`):

```ts
const SIGNATURE_FAMILY: ReadonlySet<ErrorCode> = new Set([
  'SIGNATURE_MISSING', 'SIGNATURE_MALFORMED', 'SIGNATURE_MISMATCH',
  'TIMESTAMP_MISSING', 'TIMESTAMP_INVALID', 'REPLAY_WINDOW_EXCEEDED',
]);

function defaultErrorResponse(err: WebhookError): Response {
  // Mask the failure mode on the wire — an attacker probing the endpoint
  // shouldn't be able to distinguish `SIGNATURE_MALFORMED` (their header
  // layout was right, signature was wrong) from `SIGNATURE_MISMATCH` (the
  // shape was right but the secret was wrong). Both → 'invalid_signature'.
  // The full `code` still goes to the structured logger and metrics; users
  // who want verbose responses (e.g. local dev) supply their own `onError`.
  const wireCode = SIGNATURE_FAMILY.has(err.code) ? 'invalid_signature' : err.code;
  return new Response(
    JSON.stringify({ error: wireCode }),
    { status: err.httpStatus, headers: { 'content-type': 'application/json' } },
  );
}
```

Logs include `{ providerId, code, meta }` — but **never** the rawBody, secret, or signature header.

---

## 6. Bundle & Tree-shaking Plan

### 6.1 Entry points (subpath exports)

| Entry | Purpose | Target gzip |
|---|---|---|
| `.` | Root: `createVerifier`, `defineProvider`, types | < 2 KB |
| `./errors` | Single `WebhookError` class + `ErrorCode` union | < 0.5 KB |
| `./router` | Typed router | < 1 KB |
| `./idempotency` | Middleware + memory store | < 1 KB |
| `./testing` | Sign helpers, fake clock, fixtures | < 2 KB (dev-only) |
| `./logger` | Logger interfaces + console impl | < 0.4 KB |
| `./providers` | Barrel of all providers (opt-in) | < 12 KB |
| `./providers/stripe` … `./providers/svix` | One per provider | < 1.5 KB each |
| `./adapters/fetch` | Web fetch handler | < 0.6 KB |
| `./adapters/express` | Express middleware | < 0.6 KB |
| `./adapters/fastify` | Fastify plugin | < 0.6 KB |
| `./adapters/hono` | Hono middleware | < 0.4 KB |
| `./adapters/elysia` | Elysia plugin | < 0.5 KB |
| `./adapters/next-app` | Next.js App Router | < 0.4 KB |
| `./adapters/next-pages` | Next.js Pages Router | < 0.6 KB |

### 6.2 Tree-shaking rules

- `package.json` declares `"sideEffects": false` — **must hold for every file**.
- No top-level statements with side effects (no `console.log`, no global mutation).
- Provider barrel (`providers/index.ts`) is `export * from './stripe'; …` — bundlers drop unused names.
- Each subpath has its own bundled file in `dist/`. tsup with `splitting: true` produces shared chunks for `core/*` so two providers don't duplicate it.
- Size budgets enforced by `size-limit` in CI; PR fails if any entry exceeds its limit.

### 6.3 Bundler

`tsup` (esbuild under the hood):

```ts
// tsup.config.ts (sketch, not implementation)
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/errors/index.ts',
    'src/router/index.ts',
    'src/idempotency/index.ts',
    'src/testing/index.ts',
    'src/logger/index.ts',
    'src/providers/*.ts',
    'src/adapters/*.ts',
  ],
  format: ['esm'],         // ESM only (CJS is a footgun for edge runtimes)
  dts: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  target: 'es2022',
  clean: true,
});
```

ESM-only is intentional: CF Workers, Vercel Edge, Bun, Deno, and Node ≥ 18 all support ESM natively. Users on legacy CJS Express apps can still consume via dynamic `import()` — the express adapter file does not require any host-specific syntax.

---

## 7. Dependencies

### 7.1 Runtime: zero

No `dependencies` in `package.json`. Every primitive ships from the Web platform:

| Need | Without dep, via... |
|---|---|
| HMAC / Ed25519 | `globalThis.crypto.subtle` (Web Crypto, in Node ≥ 18) |
| Timing-safe equality | Hand-rolled XOR-fold over `Uint8Array` |
| Hex / base64 | Hand-rolled (Node Buffer not available on edge; `atob`/`btoa` is unsafe for binary) |
| JSON parse | Native |
| URL parsing | `URL` global |
| Streams → Uint8Array | `new Uint8Array(await new Response(stream).arrayBuffer())` — universally available. **Not** `Response#bytes()`: TC39 stage-3, Chrome 121+/Node 20.16+ only, and Cloudflare Workers / Vercel Edge do not expose it as of 2026-04, which would break the lib's headline runtime targets. |

### 7.2 Peer dependencies (all optional)

| Peer | Why optional | Used by |
|---|---|---|
| `express ≥ 4.18` | Only if user imports `./adapters/express` | Express adapter |
| `fastify ≥ 4` | Only if user imports `./adapters/fastify` | Fastify adapter |
| `hono ≥ 4` | Only if user imports `./adapters/hono` | Hono adapter |
| `elysia ≥ 1` | Only if user imports `./adapters/elysia` | Elysia adapter |
| `next ≥ 13` | Only for type-imports in `./adapters/next-*` | Next.js adapters |

`peerDependenciesMeta.*.optional = true` for every entry — npm/pnpm/bun will not warn users who don't use a given adapter.

### 7.3 Dev dependencies — justification

| Package | Why |
|---|---|
| `typescript`, `tsup` | Build pipeline |
| `vitest`, `@vitest/coverage-v8` | Test runner — ESM-native, fast, runs in Node + Edge sims |
| `eslint`, `@typescript-eslint/*`, `prettier` | Lint & format |
| `size-limit`, `@size-limit/preset-small-lib` | Enforces bundle budgets in CI |
| `@types/node`, `@types/express` | Type-only deps |
| `express`, `fastify`, `hono`, `elysia`, `next` | For adapter tests only — never bundled |

---

## 8. Configuration

### 8.1 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "useUnknownInCatchVariables": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules", "examples"]
}
```

`tsconfig.build.json` extends and `"exclude": ["tests/**", "**/*.test.ts"]`.

### 8.2 `vitest.config.ts`

```ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/fixtures.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    include: ['tests/**/*.test.ts'],
    typecheck: { enabled: true, include: ['tests/tsd/**/*.test-d.ts'] },
  },
});
```

### 8.3 `package.json` highlights

(See actual file at repo root.)

- `"type": "module"` — ESM-only.
- `"sideEffects": false`.
- Subpath `exports` map covers every public entry; `types` is paired with `import` for full TS resolution.
- `"engines.node": ">=18.17.0"` — Web Crypto in Node became stable in 18.17 (`globalThis.crypto`).
- `"publishConfig.provenance": true` — npm provenance attestations on release.
- `peerDependenciesMeta.*.optional = true` for every framework peer.

### 8.4 `.size-limit.json` (sketch)

```json
[
  { "path": "dist/index.js", "limit": "2 KB" },
  { "path": "dist/providers/stripe.js", "limit": "1.5 KB", "ignore": ["dist/index.js"] },
  { "path": "dist/providers/github.js", "limit": "1.5 KB", "ignore": ["dist/index.js"] },
  { "path": "dist/adapters/hono.js", "limit": "0.4 KB", "ignore": ["dist/index.js"] }
]
```

---

## 9. Edge Cases the Implementation Must Handle

### 9.1 Body & encoding

1. **Pre-parsed JSON body trap.** Express w/o `express.raw()`, Next.js Pages w/o `bodyParser: false`, Hono `c.req.json()` — all destroy the byte sequence. Adapters MUST refuse pre-parsed bodies and surface a clear `ConfigError` ("Configure raw-body parser; see docs link.").
2. **Whitespace-sensitive payloads.** Stripe signs the exact bytes received; trailing newlines, BOM, or re-stringified JSON breaks signatures. Verifier never re-encodes.
3. **Streaming bodies on edge runtimes.** Some Workers deliver `request.body` as a `ReadableStream`. `core/body.ts` exposes `readRawBody(req)` which buffers exactly once and caches.
4. **Body size limit.** Default `maxBodyBytes = 1 MiB`; configurable on the verifier. Larger bodies → `PayloadParseError` (DoS-resistant).
5. **Empty body.** Some providers send pings with empty body — provider plugin decides whether to allow.

### 9.2 Headers

6. **Header case sensitivity.** Node lowercases; fetch `Headers` is case-insensitive but iterates lowercase. The `HeaderBag` shim normalizes to lowercase on input.
7. **Repeated headers.** Some providers (Twilio multi-cluster) send multiple `X-Twilio-Signature` headers. `HeaderBag.get()` returns the comma-joined list; provider parser handles this.
8. **Multiple signature versions in one header.** Stripe: `t=…,v1=sig_a,v1=sig_b,v0=sig_old`. Provider must try every `v1` and accept if any match (key rotation window).
9. **Missing required header.** → `SignatureMissingError`, never throw.

### 9.3 Crypto / verification

10. **Timing-safe comparison — canonical pattern.** Never use `===` / `==` on signatures. `core/timing-safe.ts` implements:

    ```ts
    export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
      if (a.length !== b.length) return false;   // see below — intentional, not a leak
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
      return diff === 0;
    }
    ```

    The length-pre-check is **intentional and correct** for this library's
    threat model: every supported algorithm has a fixed digest size
    (HMAC-SHA256 → 32 B, HMAC-SHA1 → 20 B, Ed25519 signature → 64 B), so
    "leaking the expected length" leaks a public constant. Any "fix" that
    XOR-folds across mismatched lengths is a foot-gun (it can spuriously
    accept a shorter forgery whose XOR happens to fold to zero against
    repeated bytes of a longer expected digest). A code comment in
    `timing-safe.ts` calls this out so a future contributor doesn't
    "harden" it back into a vulnerability.
11. **Variable-length inputs are rejected upstream.** Provider plugins'
    `parseSignature` decode hex/base64 to a `Uint8Array` whose length is
    determined by the algorithm; mismatched lengths surface as
    `SIGNATURE_MALFORMED` before `timingSafeEqual` is ever called.
12. **Wrong algorithm announced.** A provider sending a signature with an unexpected algorithm prefix → `SignatureMalformedError`, not silent fall-through.
13. **Web Crypto unavailable.** Node < 18.17 or a runtime without `crypto.subtle` → `ConfigError` at startup with remediation hint.
14. **Ed25519 import.** WebCrypto in Node 18 doesn't support Ed25519 in some patch versions. Document Node ≥ 20 as recommended for Discord/SendGrid; fall back gracefully if `subtle.importKey('raw', …, { name: 'Ed25519' }, …)` rejects.

### 9.4 Replay protection

15. **Clock skew.** Default 5-min tolerance covers normal NTP drift; configurable.
16. **Future-dated timestamps.** Reject if `ts > now + tolerance` (provider clock ahead → likely tampering).
17. **No-timestamp providers.** Shopify, GitHub-classic don't sign timestamps. Verifier logs a `replay.unsupported` warning once per process; replay is the user's responsibility (idempotency store covers this).
18. **Timestamp in seconds vs ms.** Stripe uses seconds; some Standard Webhooks impls use ms. Each provider converts to ms internally.

### 9.5 Idempotency

19. **Race between two replicas.** `IdempotencyStore.putIfAbsent` MUST be atomic. Memory impl uses a single-threaded Map; Redis uses `SET NX EX`; CF KV uses CAS or D1 unique index.
20. **Store outage.** `IdempotencyStoreError` returns 503 → provider retries → eventual consistency. Never silently skip on store error.
21. **Key collision across providers.** Idempotency key is namespaced as `${providerId}:${rawKey}`.
22. **TTL too short.** Default 24 h; provider retry windows (Stripe: 3 days) documented in the README.

### 9.6 Routing / type narrowing

23. **Unknown event type.** Library ships curated unions; unknown types fall through to a generic `{ type: string; … }` shape — `router.fallback()` catches them.
24. **Augmenting event union.** Users may declaration-merge to add custom types (documented in CONTRIBUTING).

### 9.7 Framework specifics

25. **Express + body-parser ordering.** `express.raw({ type: 'application/json' })` MUST come before the webhook handler. Adapter checks `req.body instanceof Buffer` and gives a clear error otherwise.
26. **Next.js App Router edge.** `runtime: 'edge'` forbids `node:crypto`; the lib is fine because it only uses `globalThis.crypto`.
27. **Next.js Pages.** `export const config = { api: { bodyParser: false } }` is required; adapter exports a helper.
28. **Hono `c.req.raw`.** Adapter uses `c.req.raw.clone()` to avoid consuming the body for downstream middleware.
29. **Fastify content-type parsers.** Adapter registers a route-scoped raw parser using `addContentTypeParser('*/*', { parseAs: 'buffer' }, …)`.
30. **Cloudflare Workers `request.clone()`.** Bodies can only be read once; adapter clones before reading.
31. **Bun's `Request` is fetch-compatible.** Tested in CI matrix.
32. **Deno via `Deno.serve` handler.** `adapters/fetch` works unchanged.

### 9.8 Security

33. **Secret logging.** Logger receives `{ providerId, code, hasSignature: boolean }` only — never the actual signature, secret, or body bytes.
34. **Error-message exfiltration.** Error responses are minimal (`code` + short message); detailed metadata only in structured logs.
35. **DoS via huge bodies.** `maxBodyBytes` enforced before crypto.
36. **DoS via expensive crypto.** Only one `subtle.verify` call per request; no unbounded loops over signatures (Stripe v1 list capped at 8).
37. **Constant-time decoding.** Hex/base64 decoding never short-circuits on malformed input in a way that reveals position.

### 9.9 Provider-specific footnotes

38. **Twilio** signs `URL + sorted form params` for `application/x-www-form-urlencoded`, raw body for JSON. Provider plugin handles content-type branching.
39. **Square** signs `notification_url + body`. The user must provide the public URL (verifier option `notificationUrl`).
40. **PayPal** uses certificate-chain verification (SHA256withRSA) — out of scope for v0.1. **Not shipped** in v0.1: there is no `./providers/paypal` source file and no entry in `package.json` `exports`. Tracked in Appendix A as a v0.2 deliverable so users don't get a green `import` + red runtime throw.
41. **Plaid** uses a JWT (ES256) signed payload — same treatment: not shipped in v0.1, tracked for v0.2 in Appendix A.
42. **Postmark** lacks crypto signatures; relies on Basic Auth on the inbound URL. Provider exports a `verifyBasicAuth({ user, pass })` helper that doesn't fit the standard `Verifier` shape — kept under `./providers/postmark` with its own narrow API.

### 9.10 Testing & DX

43. **Provider fixture parity.** Each provider test pulls the canonical example from the vendor's docs/SDK and asserts ✓.
44. **Replay attack fixture.** Each HMAC provider has a "valid signature, ts too old" test.
45. **Cross-runtime CI.** GitHub Actions matrix: Node 18.17 / 20 / 22, Bun latest, Deno latest, plus a Miniflare run for Workers semantics.
46. **Type-level tests.** `expect-type` ensures `router.on('payment_intent.succeeded', e => e.data.object.id)` compiles and `e.data.object.id` is `string`.

---

## Appendix A — Provider Matrix (v0.1 scope)

| Provider | Algorithm | Headers | Replay | Idempotency Key | Status |
|---|---|---|---|---|---|
| Stripe | HMAC-SHA256 | `Stripe-Signature` | ✓ (`t=`) | `event.id` | shipped |
| GitHub | HMAC-SHA256 | `X-Hub-Signature-256` | — | `X-GitHub-Delivery` | shipped |
| Shopify | HMAC-SHA256 | `X-Shopify-Hmac-Sha256` | — | `X-Shopify-Webhook-Id` | shipped |
| Twilio | HMAC-SHA1 | `X-Twilio-Signature` | — | from body / `MessageSid` | shipped |
| Slack | HMAC-SHA256 | `X-Slack-Signature` | ✓ (`X-Slack-Request-Timestamp`) | `event_id` | shipped |
| Clerk | Svix | `svix-*` | ✓ | `svix-id` | shipped |
| SendGrid | Ed25519 | `X-Twilio-Email-Event-Webhook-Signature` | ✓ | per-event id | shipped |
| Resend | Svix | `svix-*` | ✓ | `svix-id` | shipped |
| Linear | HMAC-SHA256 | `Linear-Signature` | — | `delivery` | shipped |
| Vercel | HMAC-SHA1 | `x-vercel-signature` | — | `x-vercel-delivery` | shipped |
| Discord | Ed25519 | `X-Signature-Ed25519` + `X-Signature-Timestamp` | ✓ | interaction `id` | shipped |
| Lemon Squeezy | HMAC-SHA256 | `X-Signature` | — | `X-Event-Id` | shipped |
| Paddle Billing | HMAC-SHA256 | `Paddle-Signature` | ✓ | `notification_id` | shipped |
| Square | HMAC-SHA256 | `x-square-hmacsha256-signature` | — | `event_id` | shipped |
| Mailgun | HMAC-SHA256 | (in body fields) | ✓ | `signature.token` | shipped |
| Standard Webhooks (Svix) | HMAC-SHA256 | `webhook-id`, `webhook-timestamp`, `webhook-signature` | ✓ | `webhook-id` | shipped |
| Postmark | (Basic Auth) | — | — | `MessageID` | helper-only |
| PayPal | RSA-SHA256 (cert chain) | several | ✓ | `transmission_id` | **deferred to v0.2 — no source/export in v0.1** |
| Plaid | JWT ES256 | `Plaid-Verification` | ✓ | `webhook_code+request_id` | **deferred to v0.2 — no source/export in v0.1** |

---

## Appendix B — Roadmap (post-v0.1)

- Webhook signing (outbound) under `./signing` — currently out of scope per research.
- DLQ adapter contracts (`./dlq`) for SQS/PubSub/QStash — hooks only, not transport.
- OpenTelemetry-compatible tracing helper in `./tracing`.
- PayPal & Plaid full implementations (certificate-chain verification + JWT). Will ship as new `./providers/paypal` and `./providers/plaid` subpath exports at that time.
- Codegen for typed provider event unions from each vendor's OpenAPI / docs.

---

## Review Changes

This section enumerates Vasyl Bruhanda's review points on the initial
architecture plan (PR #1) and the resulting changes. Items are listed in
the order they appear in the review.

### Blockers

**1. `WebhookProvider` interface contradicts itself (§2.2 vs §3.2).**
*Original concern:* §2.2 defined `Provider.verify` as a single opaque
method, but §3.2 described the verifier orchestrating
`parseSignature` / `buildSigningString` / `parseEvent` as separate steps.
Either the provider is a black box (and `core/timing-safe.ts` /
`core/replay.ts` can't be canonical) or it's a strategy of small pure
functions (and §2.2 was wrong).
*Resolution:* **Agreed.** Adopted §3.2's strategy decomposition.
Rewrote §2.2 — `WebhookProvider` now exposes `parseSignature`,
`extractTimestamp`, `buildSigningString`, `parseEvent` (plus optional
`idempotencyKey`). The core verifier owns timing-safe equality, replay
enforcement, body-size limits, and secret-array iteration; providers
never compare bytes or call `Date.now()`. Updated §2.7 (Stripe example)
and §2.1 (`defineWebhookProvider` example) to match. Sections modified:
**§2.1, §2.2, §2.7**.

**2. Idempotency duplicate default returns 409 → retry storms.**
*Original concern:* `IdempotencyConflictError` was tagged `409`, and
§5.3 didn't specify which `onDuplicate` mode is the default. If anything
other than `'skip'`/200 is the default, ack-non-2xx triggers Stripe/Svix
exponential retries for events the system already processed.
*Resolution:* **Agreed.** §2.5 now states explicitly that
`onDuplicate: 'skip'` is the default and that `'skip'` returns
`{ ok: false, error: WebhookError(IDEMPOTENCY_DUPLICATE) }` with
`httpStatus: 200`. Adapter still acks. 409 is reserved for
`'error'` mode for ops who want duplicates surfaced. §5.2 enum renamed
`IDEMPOTENCY_CONFLICT` → `IDEMPOTENCY_DUPLICATE` and §5.3 row rewritten.
Sections modified: **§2.5, §5.2, §5.3**.

### Major

**3. `secret: string | Uint8Array` blocks zero-downtime key rotation.**
*Original concern:* Stripe issues two active signing secrets during
rotation; §9.2 already acknowledged the verifier must "try every `v1`",
but the public type didn't accept multiple secrets.
*Resolution:* **Agreed.** §4.3 now declares
`secret: string | Uint8Array | Array<string | Uint8Array>` with JSDoc
explaining the rotation playbook. §2.1 JSDoc cross-references §9.2.
Core verifier iterates `secret × parsed-signatures` with timing-safe
equality. Sections modified: **§2.1, §4.3**.

**4. PayPal & Plaid ship as public exports but throw at runtime.**
*Original concern:* Green TS import + red runtime throw is worse DX
than not shipping the entry; npm provenance includes a dead surface.
*Resolution:* **Agreed.** Removed `./providers/paypal` and
`./providers/plaid` entries from `package.json` `exports`; removed
`paypal.ts` and `plaid.ts` from the §1 file tree. Appendix A status
column now reads "deferred to v0.2 — no source/export in v0.1".
Appendix B notes they'll ship as new subpath exports when the
implementation lands. §9.9 items 40–41 updated. Sections modified:
**§1 file tree, Appendix A, Appendix B, §9.9**, plus `package.json`.

**5. `Response(stream).bytes()` not available on Cloudflare Workers /
Vercel Edge.** *Original concern:* That method is TC39 stage-3
(Chrome 121+/Node 20.16+); Workers and Edge runtimes don't expose it,
so using it as the official stream→Uint8Array path breaks the lib's
headline runtime targets.
*Resolution:* **Agreed.** §7.1 streams row now specifies
`new Uint8Array(await new Response(stream).arrayBuffer())` with a note
on why `bytes()` is rejected. `core/body.ts` will follow this.
Sections modified: **§7.1**.

**6. Timing-safe equality description (§9.3 items 10–11) ambiguous /
potentially leaky.** *Original concern:* The original wording suggested
returning early "in constant time on the matching length", which is
nonsensical and could be "fixed" back into a vulnerability.
*Resolution:* **Agreed.** §9.3 item 10 now shows the canonical
`timingSafeEqual` source, explicitly states `if (a.length !== b.length)
return false` is the correct pattern, and explains *why* the length
pre-check is intentional (every supported algorithm has a fixed digest
size, so the "leak" is a public constant). Item 11 reframed: variable-
length inputs are rejected upstream as `SIGNATURE_MALFORMED`. Code
comment in `core/timing-safe.ts` will mirror this so a future
contributor doesn't "harden" it back. Sections modified: **§9.3**.

**7. `maxBodyBytes` documented in §9.1 but missing from `VerifierOptions`
(§4.3).** *Original concern:* If it's not in the public type, users
can't actually configure it.
*Resolution:* **Agreed.** Added `maxBodyBytes?: number` to
`VerifierOptions` (default `1_048_576`) with a `@see §9.1` reference.
Added `'PAYLOAD_TOO_LARGE'` (413) to the `ErrorCode` union since this is
its own failure mode rather than a `PAYLOAD_PARSE`. Sections modified:
**§4.3, §5.2**.

### Minor

**8. `Router.otherwise()` is unconventional.**
*Resolution:* **Agreed** (cheap to fix pre-implementation).
Renamed to `.fallback()` (matches Hono's middleware idiom). Sections
modified: **§2.4 (interface + JSDoc + naming-rationale note), §4.4**.

**9. `Provider` is too generic a name for a public root export.**
*Resolution:* **Agreed.** Public surface uses `WebhookProvider` and
`defineWebhookProvider` everywhere; `Provider` is kept as an
**internal** type alias (marked `@deprecated` so it doesn't leak into
auto-completions of new users). Same for the `defineProvider` short
alias. Sections modified: **§2.1, §2.2, §2.3, §2.5, §4.3, §4.5,
file-tree comments**.

**10. `errors/` budget < 0.5 KB unrealistic for 11 subclasses.**
*Original concern:* 11 `extends WebhookError` classes minify to
~900 B gzipped. Either bump the budget or collapse to a single class.
*Resolution:* **Agreed — picked the collapse.** §5.1 now ships **one**
`WebhookError` class with a `code: ErrorCode` discriminant. Removed
`ConfigError`, `SignatureMissingError`, …, `IdempotencyStoreError`
subclasses. Users discriminate on `error.code`, not `instanceof`
(which is a footgun across module boundaries when bundlers ship
multiple copies). §6.1 budget kept at < 0.5 KB and is now realistic.
Sections modified: **§5.1, §5.2, §5.3, §6.1**.

**11. Default error response leaks failure mode via `code`.**
*Original concern:* Wire response distinguishing `SIGNATURE_MALFORMED`
from `SIGNATURE_MISMATCH` lets an attacker probe the right header
layout.
*Resolution:* **Agreed.** §5.4 default `defaultErrorResponse` now masks
the entire `SIGNATURE_*` / `TIMESTAMP_*` / `REPLAY_*` family to a single
`{ error: 'invalid_signature' }` on the wire; full `code` only goes to
the structured logger and metrics. `VerifierOptions.onError` (added in
§4.3) is the override hatch for verbose dev responses. Sections
modified: **§4.3, §5.4**.

**12. No metrics hook on day-1 — only `Logger`.**
*Original concern:* Logger-only forces users to grep structured logs
to drive Datadog/Prometheus dashboards.
*Resolution:* **Agreed.** §4.3 adds `metrics?: Metrics` to
`VerifierOptions` with a documented set of counter names
(`verify.ok`, `verify.fail`, `replay.exceeded`, `idempotency.duplicate`,
`idempotency.store_error`) and `{ providerId, code? }` tags. Default
is noop. Roadmap (Appendix B) OTel adapter is now a thin shim.
Sections modified: **§2.1 JSDoc, §4.3**.

**13. Multi-provider single-endpoint dispatch isn't in the public API.**
*Original concern:* The report flags multi-provider ingestion as the
*primary* use case; without a built-in helper, every user rolls their
own URL-routing.
*Resolution:* **Agreed.** Added new **§2.8** documenting
`createMultiVerifier({ stripe, github, clerk }, { dispatch: 'by-path' |
'by-header' | fn })`. Returns itself a `Verifier` so it composes with
`withIdempotency`, the framework adapters, and the typed router over
the discriminated union of all child events. Implementation lives at
`src/core/multi-verifier.ts` (~40 LOC) — added to §1 file tree.
Sections modified: **§1 file tree, §2.8 (new), §2.9 (renumbered from
§2.8 — testing utilities)**.

**14. `WebhookProvider.algorithm` is redundant once §2.2 is fixed.**
*Resolution:* **Agreed.** §2.2 now explicitly tags `algorithm` as
*"metadata, surfaced in `Logger`/`Metrics` tags only — control flow
is NOT driven from this field"*. The crypto choice is implicit in
`buildSigningString` + which `core/crypto.ts` helper the provider
calls. Sections modified: **§2.2**.

### What's good — kept as-is
Vasyl's praise for the edge-first stance (§0), per-provider subpath
exports (§6.1/§6.2), the Router accumulator type (§4.4), the §9 edge-
cases catalogue, the sans-I/O core + DI (§3.3), and the Standard
Webhooks-as-one-provider framing was all kept unchanged.
