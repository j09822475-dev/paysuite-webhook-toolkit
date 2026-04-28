/**
 * with-next.ts — exercises the Next.js App Router adapter without
 * booting a Next dev server. The adapter wraps a verifier into a plain
 * `(request: Request) => Promise<Response>` function — exactly the
 * shape Next expects from `export const POST = …` — so we can call it
 * directly with a fetch `Request`.
 *
 * In a real app the file lives at:
 *
 *   app/api/webhooks/stripe/route.ts
 *   ─────────────────────────────────
 *   export const runtime = 'edge';
 *   export const POST = nextAppWebhook(verifier, async (event) => { ... });
 *
 * Run:
 *
 *   npx tsx examples/with-next.ts
 */

import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { nextAppWebhook } from '@paysuite/webhook-toolkit/adapters/next-app';
import { signWith, fixtures } from '@paysuite/webhook-toolkit/testing';

const SECRET = 'whsec_next_demo';

const verifier = createVerifier({ provider: stripe, secret: SECRET });

const POST = nextAppWebhook(verifier, async (event, ctx) => {
  if (event.type === 'payment_intent.succeeded') {
    console.log(`     ↳ markPaid(${event.data.object.id})`);
  } else if (event.type === 'charge.refunded') {
    console.log(`     ↳ issueRefund(${event.data.object.id})`);
  } else {
    console.log(`     ↳ unhandled ${event.type}`);
  }
  console.log(`     ↳ provider=${ctx.providerId} idem=${ctx.idempotencyKey ?? '-'}`);
});

const { headers, rawBody } = await signWith(stripe, {
  secret: SECRET,
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: Math.floor(Date.now() / 1000),
});

const valid = await POST(
  new Request('https://example.app/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  }),
);
console.log(`[signed]   HTTP ${valid.status}`);

const noSig = await POST(
  new Request('https://example.app/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  }),
);
console.log(`[unsigned] HTTP ${noSig.status} (signature codes mask to invalid_signature)`);

const stale = await signWith(stripe, {
  secret: SECRET,
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: Math.floor(Date.now() / 1000) - 10_000,
});
const replay = await POST(
  new Request('https://example.app/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...stale.headers },
    body: stale.rawBody,
  }),
);
console.log(`[stale-ts] HTTP ${replay.status}`);
