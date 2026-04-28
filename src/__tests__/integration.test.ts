import { describe, expect, it } from 'vitest';
import { createVerifier } from '../core/verifier.js';
import { createMultiVerifier } from '../core/multi-verifier.js';
import { withIdempotency, memoryStore } from '../idempotency/index.js';
import { createRouter } from '../router/index.js';
import { createFetchHandler } from '../adapters/fetch.js';
import { fakeClock } from '../testing/fake-clock.js';
import { signWith } from '../testing/sign.js';
import { stripe, type StripeEvent } from '../providers/stripe.js';
import { github } from '../providers/github.js';
import { extractRetryMetadata } from '../retry/index.js';
import { fromRecord } from '../core/headers.js';

const SECRET = 'whsec_test';

describe('integration: stripe verifier + idempotency + router via fetch handler', () => {
  it('should accept a valid signed request, dispatch to router, return 204, and reject duplicate as 200 skip', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({
      id: 'evt_int_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_int_1', amount: 1, currency: 'usd', status: 'ok' } },
    });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });

    const seen: StripeEvent[] = [];
    const router = createRouter<StripeEvent>()
      .on('payment_intent.succeeded', (e) => { seen.push(e); });

    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const verifier = withIdempotency(base, { store: memoryStore() });

    const fetch = createFetchHandler(verifier, async (event) => { await router.handle(event); });

    const req = () => new Request('https://api.test/hooks/stripe', {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });

    const first = await fetch(req());
    expect(first.status).toBe(204);
    expect(seen).toHaveLength(1);

    // Duplicate delivery — skipped, returns 200 by error masking → invalid_signature is NOT used
    // because IDEMPOTENCY_DUPLICATE is not in SIGNATURE_FAMILY.
    const second = await fetch(req());
    expect(second.status).toBe(200);
    const body = await second.json() as { error: string };
    expect(body.error).toBe('IDEMPOTENCY_DUPLICATE');
    expect(seen).toHaveLength(1); // handler not invoked twice
  });

  it('should reject a tampered body with masked invalid_signature', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'payment_intent.succeeded', data: { object: { id: 'p', amount: 1, currency: 'u', status: 'o' } } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });

    const verifier = createVerifier({ provider: stripe, secret: SECRET, clock });
    const fetch = createFetchHandler(verifier, async () => undefined);

    const tampered = new Uint8Array(signed.rawBody);
    tampered[0] = (tampered[0]! ^ 1);
    const req = new Request('https://api.test/hooks/stripe', {
      method: 'POST',
      headers: signed.headers,
      body: tampered,
    });
    const res = await fetch(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_signature');
  });
});

describe('integration: multi-verifier dispatches to correct provider', () => {
  it('should dispatch stripe and github webhooks via path', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const stripeSigned = await signWith(stripe, {
      secret: SECRET,
      payload: JSON.stringify({ id: 'e1', type: 'payment_intent.succeeded', data: { object: { id: 'p1', amount: 1, currency: 'u', status: 'o' } } }),
      timestamp: ts,
    });
    const ghSigned = await signWith(github, { secret: SECRET, payload: JSON.stringify({ ref: 'main' }) });

    const multi = createMultiVerifier({
      stripe: createVerifier({ provider: stripe, secret: SECRET, clock }),
      github: createVerifier({ provider: github, secret: SECRET, clock }),
    });

    const r1 = await multi.verify(new Request('https://api.test/hooks/stripe', {
      method: 'POST', headers: stripeSigned.headers, body: stripeSigned.rawBody,
    }));
    const r2 = await multi.verify(new Request('https://api.test/hooks/github', {
      method: 'POST', headers: ghSigned.headers, body: ghSigned.rawBody,
    }));

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok) expect(r1.event.providerId).toBe('stripe');
    if (r2.ok) expect(r2.event.providerId).toBe('github');
  });

  it('should tag idempotency.duplicate with the child providerId, not "multi"', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const stripeSigned = await signWith(stripe, {
      secret: SECRET,
      payload: JSON.stringify({ id: 'evt_multi_dup', type: 'payment_intent.succeeded', data: { object: { id: 'p', amount: 1, currency: 'u', status: 'o' } } }),
      timestamp: ts,
    });

    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const metrics = { increment: (n: string, t?: Record<string, string>) => calls.push([n, t]) };

    const multi = createMultiVerifier({
      stripe: createVerifier({ provider: stripe, secret: SECRET, clock }),
    });
    const wrapped = withIdempotency(multi, { store: memoryStore(), metrics });

    const req = () => new Request('https://api.test/hooks/stripe', {
      method: 'POST', headers: stripeSigned.headers, body: stripeSigned.rawBody,
    });
    await wrapped.verify(req());
    await wrapped.verify(req());

    const dup = calls.find(([n]) => n === 'idempotency.duplicate');
    expect(dup?.[1]).toEqual({ providerId: 'stripe' });
  });
});

describe('integration: retry metadata extraction', () => {
  it('should detect a github retry by header presence', () => {
    const meta = extractRetryMetadata(
      'github',
      fromRecord({ 'x-github-hook-id': 'h', 'x-github-delivery': 'd' }),
    );
    expect(meta.isRetry).toBe(true);
    expect(meta.deliveryId).toBe('d');
  });
});
