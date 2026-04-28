/**
 * advanced-usage.ts — a single endpoint that ingests Stripe + GitHub +
 * Clerk webhooks, dedupes retries via an idempotency store, branches with
 * the typed router, and supports zero-downtime secret rotation.
 *
 * What this demonstrates:
 *
 *   - `createMultiVerifier`: one URL, three vendors, one mental model.
 *   - `withIdempotency`: a redelivered Stripe event is acked but the
 *     handler runs only once.
 *   - `createRouter<StripeEvent>()`: discriminated-union narrowing — the
 *     handler for `payment_intent.succeeded` sees a typed PaymentIntent.
 *   - Secret rotation: `secret: [next, previous]` — both verify, the
 *     library tries each with timing-safe equality.
 *   - `extractRetryMetadata`: normalize per-vendor retry headers.
 *
 * Run:
 *
 *   npx tsx examples/advanced-usage.ts
 */

import { createMultiVerifier, createVerifier } from '@paysuite/webhook-toolkit';
import { stripe, type StripeEvent } from '@paysuite/webhook-toolkit/providers/stripe';
import { github } from '@paysuite/webhook-toolkit/providers/github';
import { clerk } from '@paysuite/webhook-toolkit/providers/clerk';
import { withIdempotency, memoryStore } from '@paysuite/webhook-toolkit/idempotency';
import { createRouter } from '@paysuite/webhook-toolkit/router';
import { extractRetryMetadata } from '@paysuite/webhook-toolkit/retry';
import { signWith, fixtures } from '@paysuite/webhook-toolkit/testing';

const STRIPE_SECRET_NEW = 'whsec_stripe_2026';
const STRIPE_SECRET_OLD = 'whsec_stripe_2025';
const GITHUB_SECRET = 'gh_signing_secret';
const CLERK_SECRET = 'whsec_clerk_secret';

const stripeRouter = createRouter<StripeEvent>()
  .on('payment_intent.succeeded', async (e) => {
    const pi = e.data.object;
    console.log(`     ↳ markPaid(${pi.id}, ${pi.amount} ${pi.currency})`);
  })
  .on('charge.refunded', async (e) => {
    console.log(`     ↳ issueRefund(${e.data.object.id})`);
  })
  .fallback(async (e) => {
    console.log(`     ↳ unhandled stripe event: ${e.type}`);
  });

const multi = createMultiVerifier({
  stripe: createVerifier({
    provider: stripe,
    secret: [STRIPE_SECRET_NEW, STRIPE_SECRET_OLD],
    tolerance: 300,
  }),
  github: createVerifier({ provider: github, secret: GITHUB_SECRET }),
  clerk: createVerifier({ provider: clerk, secret: CLERK_SECRET }),
});

const verifier = withIdempotency(multi, {
  store: memoryStore(),
  ttlSeconds: 86_400,
  onDuplicate: 'skip',
});

async function ingest(label: string, request: Request): Promise<void> {
  const result = await verifier.verify(request);

  if (!result.ok) {
    const e = result.error;
    if (e.code === 'IDEMPOTENCY_DUPLICATE') {
      console.log(`[${label}] duplicate → ack ${e.httpStatus}, handler skipped`);
      return;
    }
    console.log(`[${label}] reject → ${e.code} HTTP ${e.httpStatus}`);
    return;
  }

  const meta = extractRetryMetadata(result.event.providerId, normalizeHeaders(request.headers));
  console.log(
    `[${label}] ok provider=${result.event.providerId} idem=${result.idempotencyKey ?? '-'} retry=${String(meta.isRetry)}`,
  );

  switch (result.event.providerId) {
    case 'stripe':
      await stripeRouter.handle(result.event.event);
      break;
    case 'github':
      console.log(`     ↳ github action=${String(result.event.event.action ?? 'n/a')}`);
      break;
    case 'clerk':
      console.log(`     ↳ clerk type=${String(result.event.event.type ?? 'n/a')}`);
      break;
  }
}

function normalizeHeaders(h: Headers): {
  get: (n: string) => string | null;
  has: (n: string) => boolean;
  entries: () => IterableIterator<[string, string]>;
} {
  return {
    get: (n) => h.get(n),
    has: (n) => h.has(n),
    entries: () => h.entries(),
  };
}

async function buildRequest(
  url: string,
  headers: Record<string, string>,
  rawBody: Uint8Array,
): Promise<Request> {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
}

const stripeSigned = await signWith(stripe, {
  secret: STRIPE_SECRET_OLD, // Old secret still valid mid-rotation.
  payload: fixtures.stripePaymentIntentSucceeded,
  timestamp: Math.floor(Date.now() / 1000),
});
await ingest(
  'stripe-1',
  await buildRequest('https://api.example.com/webhooks/stripe', stripeSigned.headers, stripeSigned.rawBody),
);

await ingest(
  'stripe-2',
  await buildRequest('https://api.example.com/webhooks/stripe', stripeSigned.headers, stripeSigned.rawBody),
);

const githubSigned = await signWith(github, {
  secret: GITHUB_SECRET,
  payload: fixtures.githubPushEvent,
  webhookId: 'gh-delivery-001',
});
await ingest(
  'github-1',
  await buildRequest('https://api.example.com/webhooks/github', githubSigned.headers, githubSigned.rawBody),
);

const clerkSigned = await signWith(clerk, {
  secret: CLERK_SECRET,
  payload: fixtures.svixUserCreated,
  webhookId: 'msg_clerk_001',
});
await ingest(
  'clerk-1',
  await buildRequest('https://api.example.com/webhooks/clerk', clerkSigned.headers, clerkSigned.rawBody),
);

const tampered = await signWith(stripe, {
  secret: 'whsec_attacker',
  payload: fixtures.stripePaymentIntentSucceeded,
});
await ingest(
  'forged',
  await buildRequest('https://api.example.com/webhooks/stripe', tampered.headers, tampered.rawBody),
);
