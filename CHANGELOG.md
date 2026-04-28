# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-28

Initial public release.

### Added

- **Core verifier.** `createVerifier({ provider, secret, … })` returns a stateless `Verifier` whose `.verify(input)` accepts a Web `Request`, a `NormalizedRequest`, or a `{ headers, rawBody, url?, method? }` shape and returns a discriminated `VerificationResult` — never throws on a bad signature.
- **17 first-party providers** behind tree-shakeable subpath exports: Stripe, GitHub, Shopify, Twilio, Slack, Clerk, SendGrid, Resend, Linear, Vercel, Discord, Lemon Squeezy, Paddle, Square, Mailgun, Postmark, and Svix / Standard Webhooks.
- **Custom-provider escape hatch.** `defineWebhookProvider<TEvent>(spec)` plus the shared `hmacProvider`, `stripeStyleSignature`, and `svixStyleSignature` helpers.
- **Multi-provider single endpoint.** `createMultiVerifier({ stripe, github, … })` with `'by-path'`, `'by-header'`, or function dispatch; emits a discriminated event union tagged with `providerId`.
- **Pluggable idempotency.** `withIdempotency(verifier, { store, ttlSeconds, onDuplicate, metrics })` over an `IdempotencyStore` whose only required primitive is atomic `putIfAbsent`. In-memory store with lazy expiry sweep and FIFO eviction shipped; the contract is documented for Redis / Cloudflare KV / D1 / Upstash / DynamoDB.
- **Typed event router.** `createRouter<TEvent>().on(type, handler).fallback(...)` with phantom-typed `THandled` accumulator — duplicate registrations are a compile-time error and `.fallback()` is exhaustive over the remainder of the union.
- **Framework adapters.** `expressWebhook`, `fastifyWebhookPlugin` (route-scoped raw-body parser), `honoWebhook`, `elysiaWebhookPlugin`, `nextAppWebhook` (Edge-compatible), `nextPagesWebhook` (`bodyParser: false` + stream reader), and `createFetchHandler` for Cloudflare Workers / Vercel Edge / Bun / Deno.
- **Edge-first cryptography.** All HMAC-SHA256, HMAC-SHA1, and Ed25519 verification routes through `globalThis.crypto.subtle`. No `node:crypto`, no `Buffer`. `CryptoKey` instances are cached per secret bytes so the second verification reuses the imported key.
- **Replay protection.** `tolerance` defaults to 300 s; the verifier rejects requests outside the window with `REPLAY_WINDOW_EXCEEDED`. `Infinity` disables.
- **DoS guard.** `maxBodyBytes` (default 1 MiB) is enforced before any crypto runs and at the multi-verifier dispatcher (where the body is buffered once).
- **Zero-downtime secret rotation.** Pass `secret` as an array; every signature × every secret is tried with timing-safe equality.
- **Structured errors.** Single `WebhookError` class discriminated by `code` (`SIGNATURE_*`, `TIMESTAMP_*`, `REPLAY_WINDOW_EXCEEDED`, `PAYLOAD_PARSE`, `PAYLOAD_TOO_LARGE`, `IDEMPOTENCY_*`, `CONFIG`); `instanceof` is intentionally avoided across module boundaries.
- **Logger / metrics interfaces.** Structural `Logger` (pino-compatible via `fromPino`) and counter-only `Metrics` sink. Counters emitted: `verify.ok`, `verify.fail`, `replay.exceeded`, `idempotency.duplicate`, `idempotency.store_error`.
- **Retry metadata extractor.** `extractRetryMetadata(providerId, headers)` normalizes `X-GitHub-Delivery`, `svix-num-retries`, `webhook-attempt`, Shopify and Stripe headers into `{ isRetry, attempt, deliveryId }`.
- **Test helpers.** `signWith(provider, …)` produces a valid signed request for every shipped HMAC provider; `fakeClock`, `memoryStore`, and a per-provider JSON `fixtures` namespace.
- **Runtime targets.** Node 18.17+, Bun, Deno, Cloudflare Workers, Vercel Edge, browsers (for tests).
- **Bundle hygiene.** `"type": "module"`, `"sideEffects": false`, ESM-only output, per-entry chunks via `tsup`, optional peer deps for every framework.

[0.1.0]: https://github.com/j09822475-dev/paysuite-webhook-toolkit/releases/tag/v0.1.0
