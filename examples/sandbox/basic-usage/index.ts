/**
 * basic-usage.ts — minimal end-to-end verification of one Stripe webhook.
 *
 *   1. Build a verifier with `createVerifier({ provider: stripe, secret })`.
 *   2. Produce a real signed request with the test helper `signWith`.
 *   3. Hand that request to the verifier and branch on the typed event.
 *
 * Run:
 *
 *   npx tsx examples/basic-usage.ts
 */

import { createVerifier } from '@paysuite/webhook-toolkit';
import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
import { signWith, fixtures } from '@paysuite/webhook-toolkit/testing';

const SECRET = 'whsec_demo_secret';

const verifier = createVerifier({
  provider: stripe,
  secret: SECRET,
});

const { headers, rawBody } = await signWith(stripe, {
  secret: SECRET,
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: Math.floor(Date.now() / 1000),
});

const result = await verifier.verify({ headers, rawBody });

if (!result.ok) {
  console.error(`[fail] ${result.error.code}: ${result.error.message}`);
  process.exit(1);
}

console.log(`[ok] verified event id=${result.event.id} type=${result.event.type}`);
console.log(`     idempotencyKey: ${result.idempotencyKey}`);

if (result.event.type === 'payment_intent.succeeded') {
  const pi = result.event.data.object;
  console.log(`     payment_intent ${pi.id} ${pi.amount} ${pi.currency} → ${pi.status}`);
}

const tampered = await verifier.verify({
  headers,
  rawBody: new TextEncoder().encode('{"tampered":true}'),
});
if (!tampered.ok) {
  console.log(`[reject] tampered body → ${tampered.error.code} (HTTP ${tampered.error.httpStatus})`);
}
