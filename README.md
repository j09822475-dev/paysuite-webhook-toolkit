# `@paysuite/webhook-toolkit`

[![npm version](https://img.shields.io/npm/v/%40paysuite%2Fwebhook-toolkit.svg)](https://www.npmjs.com/package/@paysuite/webhook-toolkit)
[![bundle size](https://img.shields.io/bundlephobia/minzip/%40paysuite%2Fwebhook-toolkit?label=minzipped)](https://bundlephobia.com/package/@paysuite/webhook-toolkit)
[![license](https://img.shields.io/npm/l/%40paysuite%2Fwebhook-toolkit.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/%40paysuite%2Fwebhook-toolkit.svg)](https://www.typescriptlang.org/)

Universal, edge-first TypeScript toolkit for receiving, verifying, and routing webhooks from 17+ providers — one API, one mental model, zero runtime dependencies.

> **The problem.** Every provider invents its own signature scheme: Stripe's `t=…,v1=…`, GitHub's `sha256=…`, Shopify's base64 HMAC, Slack's `v0:ts:body`, Discord's Ed25519, Standard Webhooks (Svix) for Clerk/Resend… Backends end up copy-pasting verification snippets, getting raw-body wrong on serverless, forgetting timing-safe comparison, leaving replay windows wide open, and re-implementing idempotency in every endpoint. This toolkit replaces that boilerplate with one composable `Verifier` API that runs unchanged on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge.

---

## Features

- **17 first-party providers** — Stripe, GitHub, Shopify, Twilio, Slack, Clerk, SendGrid, Resend, Linear, Vercel, Discord, Lemon Squeezy, Paddle, Square, Mailgun, Postmark, Svix / Standard Webhooks. Plus `defineWebhookProvider()` for in-house schemes.
- **Edge-first** — `globalThis.crypto.subtle` only. No `node:crypto`, no `Buffer`. Works on Cloudflare Workers, Vercel Edge, Deno, Bun, and Node 18+.
- **Zero runtime dependencies.** Framework adapters are `optional` peer deps.
- **Tree-shakeable provider plugins** — import only `@paysuite/webhook-toolkit/providers/stripe` and ship < 2 KB gz of provider code.
- **Framework adapters** — Express, Fastify, Hono, Elysia, Next.js (App + Pages), and a plain Web `fetch` handler.
- **Pluggable idempotency** — `withIdempotency()` middleware over any `IdempotencyStore` (Redis, Cloudflare KV, D1, Upstash, DynamoDB, in-memory default).
- **Typed event router** — fluent `.on(type, handler)` builder with discriminated-union narrowing and compile-time exhaustiveness.
- **Multi-provider single endpoint** — `createMultiVerifier({ stripe, github, … })` dispatches on URL path or header.
- **Zero-downtime secret rotation** — pass an array of secrets; every entry is tried with timing-safe equality.
- **Result-style API** — verification returns a discriminated `VerificationResult`; misconfiguration throws synchronously.
- **Replay protection, body-size cap, structured logging, counter metrics** — built in.
- **Test helpers** — `signWith(provider, …)` produces a valid signed request for every shipped provider; `fakeClock`, `memoryStore`, JSON fixtures included.

---

## Install

```bash
npm install @paysuite/webhook-toolkit
# or: pnpm add @paysuite/webhook-toolkit / yarn add @paysuite/webhook-toolkit / bun add @paysuite/webhook-toolkit
```

Requires **Node 18.17+**, Bun, Deno, or any V8 / WebKit-based edge runtime exposing `globalThis.crypto.subtle`.

---

## Quick Start

```ts
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';

const verifier = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });

export default async (request: Request): Promise<Response> => {
  const result = await verifier.verify(request);
  if (!result.ok) return new Response(result.error.message, { status: result.error.httpStatus });
  if (result.event.type === 'payment_intent.succeeded') await markPaid(result.event.data.object.id);
  return new Response(null, { status: 204 });
};
```

---

## API Reference

### `createVerifier(options)`

Build a stateless, runtime-agnostic `Verifier` for one provider.

```ts
function createVerifier<P extends WebhookProvider>(options: {
  provider: P;
  secret: string | Uint8Array | ReadonlyArray<string | Uint8Array>;
  tolerance?: number;     // replay window in seconds. Default 300. Infinity disables.
  maxBodyBytes?: number;  // DoS guard. Default 1_048_576 (1 MiB).
  clock?: Clock;
  logger?: Logger;
  metrics?: Metrics;
  onError?: (err: WebhookError) => Response;
}): Verifier<P>;
```

`secret` accepts an array for **zero-downtime key rotation** — pass the new secret first, the old one second. Every signature × every secret is tried with timing-safe equality.

```ts
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';

const verifier = createVerifier({
  provider: stripe,
  secret: [process.env.STRIPE_SECRET_NEW!, process.env.STRIPE_SECRET_OLD!],
  tolerance: 300,
});
```

### `Verifier<P>`

```ts
interface Verifier<P> {
  readonly providerId: string;
  verify(input: Request | NormalizedRequest | { headers, rawBody, url?, method? }): Promise<VerificationResult<EventOf<P>>>;
}
```

`verify` **never throws** on a bad signature — every failure is returned as `{ ok: false, error: WebhookError }`. `error.code` discriminates the failure (`SIGNATURE_MISSING`, `SIGNATURE_MISMATCH`, `REPLAY_WINDOW_EXCEEDED`, `PAYLOAD_TOO_LARGE`, …).

```ts
const result = await verifier.verify(request);
if (!result.ok) {
  if (result.error.code === 'REPLAY_WINDOW_EXCEEDED') metrics.increment('replay');
  return new Response(result.error.message, { status: result.error.httpStatus });
}
result.event;          // fully typed StripeEvent discriminated union
result.idempotencyKey; // 'stripe:evt_…' or null
result.rawBody;        // Uint8Array
result.receivedAt;     // epoch ms
```

### `createMultiVerifier(verifiers, options?)`

Compose several `Verifier`s into one dispatching `Verifier`. Dispatch is by last URL path segment (default), by header, or by user function.

```ts
import { createMultiVerifier } from '@paysuite/webhook-toolkit';

const multi = createMultiVerifier({
  stripe: createVerifier({ provider: stripe, secret: env.STRIPE_SECRET }),
  github: createVerifier({ provider: github, secret: env.GH_SECRET }),
}); // POST /webhooks/stripe → stripe; POST /webhooks/github → github

const r = await multi.verify(request);
if (r.ok && r.event.providerId === 'stripe') {
  r.event.event; // narrowed to StripeEvent
}
```

Header-based dispatch:

```ts
createMultiVerifier(verifiers, { dispatch: 'by-header', headerName: 'x-webhook-provider' });
```

Function dispatch (full request inspection):

```ts
createMultiVerifier(verifiers, {
  dispatch: (req) => req.headers.get('x-tenant')?.startsWith('stripe-') ? 'stripe' : 'github',
});
```

### `defineWebhookProvider(spec)`

Build a custom provider plugin. Identity function — exists to give a typed, named entry point.

```ts
import { defineWebhookProvider } from '@paysuite/webhook-toolkit';

export const myCorpProvider = defineWebhookProvider<MyCorpEvent>({
  id: 'mycorp',
  algorithm: 'HMAC-SHA256',
  parseSignature: (h) => {
    const raw = h.get('x-mycorp-signature');
    return raw ? { signatures: [hex.decode(raw)], raw } : null;
  },
  extractTimestamp: (h) => Number(h.get('x-mycorp-timestamp')) * 1000 || null,
  buildSigningString: ({ rawBody, timestamp }) => concat(utf8.encode(`${timestamp ?? 0}.`), rawBody),
  parseEvent: (raw) => JSON.parse(utf8.decode(raw)),
});
```

### `withIdempotency(verifier, options)` — `@paysuite/webhook-toolkit/idempotency`

Wrap a verifier so previously-seen webhook IDs short-circuit. Composes — the result is itself a `Verifier`.

```ts
import { withIdempotency, memoryStore } from '@paysuite/webhook-toolkit/idempotency';

const verifier = withIdempotency(base, {
  store: memoryStore(),     // or Redis / KV / D1 / Upstash / DynamoDB
  ttlSeconds: 86_400,
  onDuplicate: 'skip',      // 'skip' | 'replay-cached' | 'error'
});
```

`onDuplicate`:

| Mode             | Returned error code              | HTTP | Behaviour                                                 |
|------------------|-----------------------------------|------|-----------------------------------------------------------|
| `'skip'` (default) | `IDEMPOTENCY_DUPLICATE`         | 200  | Ack so the provider stops retrying. Handler not invoked.  |
| `'replay-cached'`  | `IDEMPOTENCY_DUPLICATE`         | 200  | Returns the cached response body (requires `saveResult`). |
| `'error'`          | `IDEMPOTENCY_DUPLICATE`         | 409  | Surface the duplicate as a programmer bug.                |

The `IdempotencyStore` contract is one atomic primitive — implement it on any KV-style backend:

```ts
interface IdempotencyStore {
  putIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
  saveResult?(key: string, value: Uint8Array, ttlSeconds: number): Promise<void>;
  getResult?(key: string): Promise<Uint8Array | null>;
}
```

### `createRouter<TEvent>()` — `@paysuite/webhook-toolkit/router`

Fluent, type-safe router over a discriminated event union. Each `.on(type, handler)` narrows the handler's `event`; duplicate registrations are a compile-time error.

```ts
import { createRouter } from '@paysuite/webhook-toolkit/router';
import type { StripeEvent } from '@paysuite/webhook-toolkit/providers/stripe';

const router = createRouter<StripeEvent>()
  .on('payment_intent.succeeded', async (e) => markPaid(e.data.object.id))
  .on('charge.refunded',          async (e) => issueRefund(e.data.object.id))
  .fallback(async (e) => log.warn('unhandled', { type: e.type }));

await router.handle(verified.event);
```

### `extractRetryMetadata(providerId, headers)` — `@paysuite/webhook-toolkit/retry`

Normalize per-provider retry signals (`X-GitHub-Delivery`, `svix-num-retries`, `webhook-attempt`, …) into a common shape:

```ts
interface RetryMetadata {
  isRetry: boolean;
  attempt: number | null;
  deliveryId: string | null;
}
```

### `signWith(provider, options)` — `@paysuite/webhook-toolkit/testing`

Produce a valid signed request for any HMAC-based provider — for integration tests without the vendor SDK.

```ts
import { signWith, fakeClock, memoryStore, fixtures } from '@paysuite/webhook-toolkit/testing';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';

const { headers, rawBody } = await signWith(stripe, {
  secret: 'whsec_test',
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: 1714200000,
});
const result = await verifier.verify({ headers, rawBody });
```

`signWith` covers every shipped provider except Discord / SendGrid (Ed25519 — supply a real keypair), Mailgun (signature lives in body), and Postmark (Basic auth).

### Errors — `@paysuite/webhook-toolkit/errors`

Single class, branded `code`. `instanceof` is intentionally avoided across module boundaries.

```ts
class WebhookError extends Error {
  readonly code: ErrorCode;       // discriminant
  readonly httpStatus: number;
  readonly providerId: string;
  readonly meta: Record<string, unknown>;
}
```

| `ErrorCode`                | HTTP | Meaning                                              |
|----------------------------|------|------------------------------------------------------|
| `CONFIG`                   | 500  | Misconfiguration (thrown synchronously, not returned)|
| `SIGNATURE_MISSING`        | 400  | Required header not present                          |
| `SIGNATURE_MALFORMED`      | 400  | Header present but un-parsable                       |
| `SIGNATURE_MISMATCH`       | 401  | No secret matched                                    |
| `TIMESTAMP_MISSING`        | 400  | Provider signs a timestamp; header was absent        |
| `TIMESTAMP_INVALID`        | 400  | Timestamp could not be parsed                        |
| `REPLAY_WINDOW_EXCEEDED`   | 400  | Outside `tolerance`                                  |
| `PAYLOAD_PARSE`            | 400  | Verified body failed `parseEvent`                    |
| `PAYLOAD_TOO_LARGE`        | 413  | Body exceeded `maxBodyBytes`                         |
| `IDEMPOTENCY_DUPLICATE`    | 200/409 | Key already seen (mode-dependent)                 |
| `IDEMPOTENCY_STORE`        | 503  | Store unavailable                                    |

### Logger / Metrics

`Logger` is a structural `{ debug, info, warn, error }` shape — pino-compatible via `fromPino()`. `Metrics` is counter-only:

```ts
import { fromPino } from '@paysuite/webhook-toolkit/logger/pino';
import pino from 'pino';

createVerifier({ provider: stripe, secret, logger: fromPino(pino()) });
```

Counter names emitted: `verify.ok`, `verify.fail` (tagged with `code`), `replay.exceeded`, `idempotency.duplicate`, `idempotency.store_error` — all tagged with `providerId`.

---

## Framework Guides

### Next.js (App Router, Edge-compatible)

```ts
// app/api/webhooks/stripe/route.ts
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { nextAppWebhook } from '@paysuite/webhook-toolkit/adapters/next-app';

export const runtime = 'edge';

const verifier = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });

export const POST = nextAppWebhook(verifier, async (event) => {
  if (event.type === 'payment_intent.succeeded') await markPaid(event.data.object.id);
});
```

For the Pages Router, disable the body parser and use `nextPagesWebhook`:

```ts
// pages/api/webhooks/stripe.ts
import { nextPagesWebhook } from '@paysuite/webhook-toolkit/adapters/next-pages';
export const config = { api: { bodyParser: false } };
export default nextPagesWebhook(verifier, async (event) => { /* ... */ });
```

### Express

> The library never trusts pre-parsed JSON. Mount `express.raw()` **before** the webhook handler — pre-parsed bodies destroy the byte sequence required for verification.

```ts
import express from 'express';
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { expressWebhook } from '@paysuite/webhook-toolkit/adapters/express';

const app = express();
const verifier = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });

app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  expressWebhook(verifier, async (event) => { /* ... */ }),
);
```

### Hono (Cloudflare Workers, Bun, Deno, Node)

```ts
import { Hono } from 'hono';
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { honoWebhook } from '@paysuite/webhook-toolkit/adapters/hono';

const app = new Hono<{ Bindings: { STRIPE_SECRET: string } }>();

app.post('/webhooks/stripe', (c) => {
  const verifier = createVerifier({ provider: stripe, secret: c.env.STRIPE_SECRET });
  return honoWebhook(verifier, async (event) => { /* ... */ })(c);
});

export default app;
```

### Plain `fetch` (Cloudflare Workers / Vercel Edge / Bun / Deno)

```ts
import { createFetchHandler } from '@paysuite/webhook-toolkit/adapters/fetch';

export default {
  fetch: createFetchHandler(verifier, async (event) => { /* ... */ }),
};
```

### Fastify

```ts
import { fastifyWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/fastify';

fastifyWebhookPlugin(fastify, {
  path: '/webhooks/stripe',
  verifier,
  handler: async (event) => { /* ... */ },
});
```

The plugin registers a route-scoped raw-body content-type parser; it does not touch your global JSON parser.

### Elysia (Bun)

```ts
import { Elysia } from 'elysia';
import { elysiaWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/elysia';

new Elysia().use(elysiaWebhookPlugin({
  path: '/webhooks/stripe',
  verifier,
  handler: async (event) => { /* ... */ },
}));
```

---

## Configuration Options

`createVerifier(options)`:

| Option         | Type                                              | Default      | Description                                                      |
|----------------|----------------------------------------------------|--------------|------------------------------------------------------------------|
| `provider`     | `WebhookProvider<TEvent>`                          | —            | **Required.** Provider plugin (`stripe`, `github`, …).           |
| `secret`       | `string \| Uint8Array \| ReadonlyArray<…>`         | —            | **Required.** Single secret or rotation list.                    |
| `tolerance`    | `number` (seconds)                                 | `300`        | Replay window. `Infinity` disables.                              |
| `maxBodyBytes` | `number`                                           | `1_048_576`  | Hard upper bound enforced before any crypto runs (DoS guard).    |
| `clock`        | `Clock`                                            | `systemClock`| Override `Date.now()` for tests.                                 |
| `logger`       | `Logger`                                           | no-op        | Structured logger; emits `verify.ok` / `verify.fail` / etc.      |
| `metrics`      | `Metrics`                                          | no-op        | Counter sink. Tags include `providerId` and (on failure) `code`. |
| `onError`      | `(err: WebhookError) => Response`                  | masking      | Override default response shaping; default masks signature codes.|

`withIdempotency(verifier, options)`:

| Option          | Type                                  | Default       | Description                                                |
|-----------------|---------------------------------------|---------------|------------------------------------------------------------|
| `store`         | `IdempotencyStore`                    | —             | **Required.** Atomic `putIfAbsent` backend.                |
| `ttlSeconds`    | `number`                              | `86_400`      | TTL for stored keys.                                       |
| `onDuplicate`   | `'skip' \| 'replay-cached' \| 'error'`| `'skip'`      | Behaviour on duplicate.                                    |
| `metrics`       | `Metrics`                             | undefined     | Counter sink — `idempotency.duplicate` / `_store_error`.   |

`createMultiVerifier(verifiers, options?)`:

| Option          | Type                                                            | Default              | Description                                          |
|-----------------|-----------------------------------------------------------------|----------------------|------------------------------------------------------|
| `dispatch`      | `'by-path' \| 'by-header' \| (req) => keyof TVerifiers \| null` | `'by-path'`          | How to choose a child verifier.                      |
| `headerName`    | `string`                                                        | `'x-webhook-provider'` | Header inspected when `dispatch === 'by-header'`.    |
| `maxBodyBytes`  | `number`                                                        | `1_048_576`          | Body cap enforced once before dispatch.              |

---

## TypeScript Features

- **Discriminated event unions per provider.** Importing `stripe` brings a `StripeEvent` union along — `result.event.type === 'payment_intent.succeeded'` narrows `data.object` to `StripePaymentIntent` automatically.
- **`EventOf<P>` helper.** Extracts the event payload type from any `WebhookProvider<P>`; carried through `withIdempotency`, the framework adapters, and the multi-verifier.
- **Multi-verifier merge.** `createMultiVerifier({ stripe, github })` produces a discriminated union `{ providerId: 'stripe'; event: StripeEvent } | { providerId: 'github'; event: GitHubEvent }`.
- **Phantom-typed router.** `createRouter<TEvent>().on(...).on(...)` accumulates handled types in a phantom parameter — registering the same type twice is a compile-time error; `.fallback()` is exhaustive over the remainder.
- **Strict `strictFunctionTypes` / `exactOptionalPropertyTypes` clean.** No type assertions in user-visible APIs (one is internal to the router builder, documented in source).
- **Structural logger / metrics.** `Logger` is a plain shape — pino, winston, console, or your own all match without adapters; `fromPino()` is provided to swap pino's `(meta, msg)` argument order.

---

## Comparison vs. Alternatives

| Library                        | Coverage                              | Adapters                          | Idempotency | Edge runtime | Typed router | Bundle†       |
|--------------------------------|---------------------------------------|-----------------------------------|-------------|--------------|--------------|---------------|
| **`@paysuite/webhook-toolkit`** | **17 providers + custom**            | Express, Fastify, Hono, Elysia, Next.js (App + Pages), `fetch` | ✅ Pluggable (Redis / KV / D1 / Upstash / DynamoDB / memory) | ✅ Web Crypto only | ✅ Phantom-typed builder | ~ 4–8 KB gz per provider |
| `standardwebhooks`             | Standard Webhooks (Svix) only         | None                              | ❌          | ✅           | ❌           | ~ 5 KB        |
| `@octokit/webhooks`            | GitHub only                           | Express, Node middleware          | ❌          | ⚠️ Partial   | ✅ (GitHub)  | ~ 80 KB       |
| `svix`                         | Standard Webhooks (Svix) only         | None                              | Sending side via SaaS | ✅ | ❌ | ~ 12 KB |
| `@upstash/qstash`              | QStash only (vendor lock-in)          | Next.js helpers                   | ✅ (built-in) | ✅          | ❌           | ~ 18 KB       |
| `github-webhook-handler`       | GitHub only (unmaintained since 2022) | Node `http`                       | ❌          | ❌           | ❌           | ~ 6 KB        |
| First-party SDKs (Stripe, Shopify, Clerk, …) | Single vendor each      | Vendor-specific                   | Varies      | Mixed        | ✅ (per SDK) | 50–500 KB     |

† Bundle is per-provider for `@paysuite/webhook-toolkit` thanks to subpath exports + `sideEffects: false`. Numbers from competitors are full installed weight (Bundlephobia minzipped, approximate).

**When to use `@paysuite/webhook-toolkit`:** you receive webhooks from more than one provider, you ship to an edge runtime, you want one mental model and one logging / metrics surface across vendors, and you don't want to glue together five vendor SDKs and a Map for idempotency.

**When NOT to use it:** you only ever consume Standard Webhooks and want zero abstraction (use `standardwebhooks` directly); you only consume GitHub (use `@octokit/webhooks` for richer GitHub-specific affordances); you want a hosted gateway with a UI / DLQ (use Svix or Hookdeck SaaS).

---

## Provider Matrix

| Provider              | Header(s)                                                  | Algorithm     | Replay window | Idempotency key                |
|-----------------------|------------------------------------------------------------|---------------|---------------|--------------------------------|
| `stripe`              | `Stripe-Signature`                                         | HMAC-SHA256   | ✅ via `t=`   | `event.id` (body)              |
| `github`              | `X-Hub-Signature-256`                                      | HMAC-SHA256   | —             | `X-GitHub-Delivery`            |
| `shopify`             | `X-Shopify-Hmac-Sha256`                                    | HMAC-SHA256   | —             | `X-Shopify-Webhook-Id`         |
| `twilio`              | `X-Twilio-Signature`                                       | HMAC-SHA1     | —             | —                              |
| `slack`               | `X-Slack-Signature` + `X-Slack-Request-Timestamp`          | HMAC-SHA256   | ✅            | —                              |
| `clerk`               | `webhook-signature` + `webhook-id` + `webhook-timestamp`   | HMAC-SHA256   | ✅            | `webhook-id`                   |
| `sendgrid`            | `X-Twilio-Email-Event-Webhook-Signature`                   | Ed25519       | ✅            | —                              |
| `resend`              | `webhook-signature` + `webhook-id` + `webhook-timestamp`   | HMAC-SHA256   | ✅            | `webhook-id`                   |
| `linear`              | `Linear-Signature`                                         | HMAC-SHA256   | —             | —                              |
| `vercel`              | `x-vercel-signature`                                       | HMAC-SHA1     | —             | `x-vercel-delivery`            |
| `discord`             | `X-Signature-Ed25519` + `X-Signature-Timestamp`            | Ed25519       | ✅            | `id` (body)                    |
| `lemon-squeezy`       | `X-Signature` + `X-Event-Id`                               | HMAC-SHA256   | —             | `X-Event-Id`                   |
| `paddle`              | `Paddle-Signature`                                         | HMAC-SHA256   | ✅ via `ts=`  | —                              |
| `square`              | `x-square-hmacsha256-signature`                            | HMAC-SHA256   | —             | —                              |
| `mailgun`             | (signature in body: `signature.{timestamp,token,signature}`) | HMAC-SHA256 | ✅            | —                              |
| `postmark`            | HTTP Basic auth (no signature)                             | n/a           | —             | `MessageID` (body)             |
| `svix`                | `webhook-signature` + `webhook-id` + `webhook-timestamp`   | HMAC-SHA256   | ✅            | `webhook-id`                   |

Every provider lives behind its own subpath export — `import { stripe } from '@paysuite/webhook-toolkit/providers/stripe'` — so the bundle only contains the providers you actually use.

---

## Contributing

Issues and pull requests are welcome at <https://github.com/j09822475-dev/paysuite-webhook-toolkit>.

To add a new provider plugin:

1. Add `src/providers/<name>.ts` exporting a `WebhookProvider<TEvent>`. For HMAC-style providers, build on `_shared/hmac-provider.ts`. For Standard-Webhooks-style providers, reuse `svixStyleProvider`.
2. Add the test fixture and a `signWith` arm if the provider uses HMAC; for Ed25519 keep tests behind a real keypair.
3. Add a subpath entry to `package.json#exports` and `tsup.config.ts`.
4. Add a row to the Provider Matrix above.

Local development:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run size
```

## License

MIT © Mykhailo Kryvytskyi. See [LICENSE](./LICENSE).
