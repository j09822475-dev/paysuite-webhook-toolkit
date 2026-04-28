# Hono adapter — `@paysuite/webhook-toolkit`

The Hono adapter exposes a `Verifier` as a Hono middleware. The same code runs unchanged on **Cloudflare Workers, Bun, Deno, and Node** — only `globalThis.crypto.subtle` is used, no `node:crypto`, no `Buffer`.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/j09822475-dev/paysuite-webhook-toolkit/tree/main/examples/sandbox/with-hono)

## Run locally

```bash
npm install
npm start
```

## What it shows

- `honoWebhook(verifier, async (event, ctx) => …)` — drop-in Hono handler.
- Composes with `withIdempotency` so retries are acked but the handler runs once.
- Exercised in-process via `app.fetch(request)` — no port to bind, no shell server.
- HTTP responses for: signed (204), replayed-duplicate (200), tampered (401), unsigned (400).

## Production deployment (Cloudflare Workers)

```ts
import { Hono } from 'hono';
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { honoWebhook } from '@paysuite/webhook-toolkit/adapters/hono';

const app = new Hono<{ Bindings: { STRIPE_SECRET: string } }>();

app.post('/webhooks/stripe', (c) => {
  const verifier = createVerifier({ provider: stripe, secret: c.env.STRIPE_SECRET });
  return honoWebhook(verifier, async (event) => { /* … */ })(c);
});

export default app;
```
