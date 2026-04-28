/**
 * with-hono.ts — webhook ingestion with the Hono adapter, exercised
 * against the in-process `app.fetch(request)` handler. The same code
 * runs unchanged on Cloudflare Workers, Bun, Deno, and Node — no
 * `node:crypto`, no `Buffer`.
 *
 * Run:
 *
 *   npx tsx examples/with-hono.ts
 */

import { Hono } from 'hono';
import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { honoWebhook } from '@paysuite/webhook-toolkit/adapters/hono';
import { withIdempotency, memoryStore } from '@paysuite/webhook-toolkit/idempotency';
import { signWith, fixtures } from '@paysuite/webhook-toolkit/testing';

const SECRET = 'whsec_hono_demo';

const verifier = withIdempotency(
  createVerifier({ provider: stripe, secret: SECRET }),
  { store: memoryStore(), onDuplicate: 'skip' },
);

const app = new Hono();

app.post(
  '/webhooks/stripe',
  honoWebhook(verifier, async (event, ctx) => {
    if (event.type === 'payment_intent.succeeded') {
      console.log(`     ↳ markPaid(${event.data.object.id})`);
    } else {
      console.log(`     ↳ unhandled ${event.type}`);
    }
    console.log(`     ↳ idempotencyKey=${ctx.idempotencyKey ?? '-'}`);
  }),
);

app.get('/', (c) => c.text('webhook receiver up'));

const { headers, rawBody } = await signWith(stripe, {
  secret: SECRET,
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: Math.floor(Date.now() / 1000),
});

const send = async (label: string, body: Uint8Array): Promise<void> => {
  const res = await app.fetch(
    new Request('http://localhost/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
  );
  console.log(`[${label}] HTTP ${res.status}`);
};

await send('signed', rawBody);
await send('replay', rawBody);
await send('tampered', new TextEncoder().encode('{"tampered":true}'));

const unsigned = await app.fetch(
  new Request('http://localhost/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  }),
);
console.log(`[unsigned] HTTP ${unsigned.status}`);
