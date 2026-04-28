# Next.js App Router adapter — `@paysuite/webhook-toolkit`

The Next.js App Router adapter wraps a `Verifier` into a plain `(request: Request) => Promise<Response>` function — the exact shape Next expects from `export const POST = …`. **Edge-runtime compatible** — only Web Crypto is used.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/j09822475-dev/paysuite-webhook-toolkit/tree/main/examples/sandbox/with-next)

## Run locally

```bash
npm install
npm start
```

The example exercises the route handler in-process by calling it with a `Request` directly — no Next dev server required. In a real app, the same factory output is bound to `export const POST`.

## In a real Next.js app

```ts
// app/api/webhooks/stripe/route.ts
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { nextAppWebhook } from '@paysuite/webhook-toolkit/adapters/next-app';

export const runtime = 'edge';

const verifier = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });

export const POST = nextAppWebhook(verifier, async (event) => {
  if (event.type === 'payment_intent.succeeded') {
    await markPaid(event.data.object.id);
  }
});
```

## What this example shows

- The wrapped handler returns the right HTTP status for every failure mode (204 / 400 / 401).
- Signature-family errors mask to a single `'invalid_signature'` shape on the wire — the failure mode is not leaked to a hostile caller.
- A stale timestamp (outside the 300-second tolerance) is rejected as `REPLAY_WINDOW_EXCEEDED`.
