# Advanced usage — `@paysuite/webhook-toolkit`

A single endpoint that ingests **Stripe + GitHub + Clerk** webhooks, dedupes retries, and routes Stripe events through a typed router — with zero-downtime secret rotation enabled for Stripe.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/j09822475-dev/paysuite-webhook-toolkit/tree/main/examples/sandbox/advanced-usage)

## Run locally

```bash
npm install
npm start
```

## What it shows

- `createMultiVerifier({ stripe, github, clerk })` — one URL, three vendors, dispatched by URL path segment.
- `withIdempotency(multi, { store: memoryStore() })` — a redelivered Stripe event is acked but the handler runs only once.
- `createRouter<StripeEvent>()` — `.on('payment_intent.succeeded', …)` narrows the event payload at compile time.
- Secret rotation: `secret: [STRIPE_SECRET_NEW, STRIPE_SECRET_OLD]` — both verify with timing-safe equality.
- `extractRetryMetadata(providerId, headers)` — normalize per-vendor retry signals.
- Forged signature rejected with `SIGNATURE_MISMATCH` (HTTP 401).
