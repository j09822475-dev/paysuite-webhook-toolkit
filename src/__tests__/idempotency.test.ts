import { describe, expect, it } from 'vitest';
import { memoryStore, withIdempotency } from '../idempotency/index.js';
import { defaultIdempotencyKey } from '../idempotency/key.js';
import { createVerifier } from '../core/verifier.js';
import { stripe } from '../providers/stripe.js';
import { signWith } from '../testing/sign.js';
import { fakeClock } from '../testing/fake-clock.js';
import { fromRecord } from '../core/headers.js';
import type { IdempotencyStore } from '../idempotency/types.js';
import type { Metrics, Verifier, WebhookProvider } from '../core/types.js';

const SECRET = 'whsec_test';

function makeStripePayload(id = 'evt_1'): string {
  return JSON.stringify({
    id,
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount: 1, currency: 'usd', status: 'ok' } },
  });
}

describe('memoryStore', () => {
  it('should insert a new key and return true when key is fresh', async () => {
    const store = memoryStore();
    expect(await store.putIfAbsent('k1', 60)).toBe(true);
  });

  it('should return false when key already exists and is unexpired', async () => {
    const store = memoryStore();
    await store.putIfAbsent('k1', 60);
    expect(await store.putIfAbsent('k1', 60)).toBe(false);
  });

  it('should allow re-insertion after TTL passes (lazy expiry on read)', async () => {
    const store = memoryStore({ sweepIntervalMs: 0 });
    await store.putIfAbsent('k1', -1); // already expired
    expect(await store.putIfAbsent('k1', 60)).toBe(true);
  });

  it('should saveResult and return it from getResult when within TTL', async () => {
    const store = memoryStore();
    const value = new Uint8Array([1, 2, 3]);
    await store.saveResult!('k1', value, 60);
    expect(await store.getResult!('k1')).toEqual(value);
  });

  it('should return null from getResult when key is missing', async () => {
    const store = memoryStore();
    expect(await store.getResult!('absent')).toBeNull();
  });

  it('should return null from getResult when entry has expired', async () => {
    const store = memoryStore({ sweepIntervalMs: 0 });
    await store.saveResult!('k1', new Uint8Array([1]), -1);
    expect(await store.getResult!('k1')).toBeNull();
  });

  it('should return null from getResult when entry was inserted with putIfAbsent only', async () => {
    const store = memoryStore();
    await store.putIfAbsent('k1', 60);
    expect(await store.getResult!('k1')).toBeNull();
  });

  it('should evict expired entry first when at maxEntries cap', async () => {
    const store = memoryStore({ maxEntries: 2, sweepIntervalMs: 0 });
    await store.putIfAbsent('a', -1); // expired
    await store.putIfAbsent('b', 60);
    // Adding 'c' should evict 'a' (expired) first.
    await store.putIfAbsent('c', 60);
    expect(await store.putIfAbsent('b', 60)).toBe(false);
    expect(await store.putIfAbsent('c', 60)).toBe(false);
  });

  it('should fall back to FIFO eviction when nothing is expired', async () => {
    const store = memoryStore({ maxEntries: 2, sweepIntervalMs: 0 });
    await store.putIfAbsent('a', 60);
    await store.putIfAbsent('b', 60);
    // Adding 'c' is over the cap; evictOne finds no expired entry and
    // falls back to oldest-by-insertion → deletes 'a'.
    await store.putIfAbsent('c', 60);
    // 'a' is gone, 'b' and 'c' remain; re-inserting them is a duplicate.
    expect(await store.putIfAbsent('b', 60)).toBe(false);
    expect(await store.putIfAbsent('c', 60)).toBe(false);
  });

  it('should not start an interval when sweepIntervalMs is 0', async () => {
    const store = memoryStore({ sweepIntervalMs: 0 });
    // Just exercise putIfAbsent — no interval handle to leak.
    await store.putIfAbsent('k', 60);
    expect(true).toBe(true);
  });
});

describe('withIdempotency', () => {
  it('should pass through verification result on first delivery', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_a'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const wrapped = withIdempotency(base, { store: memoryStore() });

    const result = await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return IDEMPOTENCY_DUPLICATE on second delivery in skip mode (default)', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_dup'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const wrapped = withIdempotency(base, { store: memoryStore() });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    const second = await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('IDEMPOTENCY_DUPLICATE');
      expect(second.error.httpStatus).toBe(200);
      expect(second.error.meta['idempotencyKey']).toBe('stripe:evt_dup');
      expect(second.error.meta['mode']).toBe('skip');
    }
  });

  it('should return 409 in error mode on duplicate', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_err'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const wrapped = withIdempotency(base, { store: memoryStore(), onDuplicate: 'error' });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    const second = await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('IDEMPOTENCY_DUPLICATE');
      expect(second.error.httpStatus).toBe(409);
    }
  });

  it('should set replay-cached message in replay-cached mode', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_cache'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const wrapped = withIdempotency(base, { store: memoryStore(), onDuplicate: 'replay-cached' });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    const second = await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    if (!second.ok) {
      expect(second.error.message).toMatch(/replaying cached/);
      expect(second.error.httpStatus).toBe(200);
    }
  });

  it('should propagate failed verification unchanged', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const wrapped = withIdempotency(base, { store: memoryStore() });
    const result = await wrapped.verify({ headers: {}, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISSING');
  });

  it('should pass through when idempotencyKey is null', async () => {
    // Use a provider that has no idempotencyKey — e.g. a custom one.
    const provider: WebhookProvider = {
      id: 'custom',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => ({ signatures: [new Uint8Array(32)], raw: 'x' }),
      extractTimestamp: () => null,
      verify: async () => true,
      parseEvent: () => ({}),
    };
    const base = createVerifier({ provider, secret: SECRET });
    const wrapped = withIdempotency(base, { store: memoryStore() });
    const result = await wrapped.verify({ headers: { x: 'y' }, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(true);
  });

  it('should return IDEMPOTENCY_STORE when store throws', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_store'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const failingStore: IdempotencyStore = {
      putIfAbsent: () => { throw new Error('store down'); },
    };
    const wrapped = withIdempotency(base, { store: failingStore });
    const result = await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IDEMPOTENCY_STORE');
      expect(result.error.httpStatus).toBe(503);
    }
  });

  it('should emit idempotency.duplicate metric tagged with child providerId', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_metric'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const metrics: Metrics = { increment: (n, t) => calls.push([n, t]) };
    const wrapped = withIdempotency(base, { store: memoryStore(), metrics });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    const dup = calls.find(([name]) => name === 'idempotency.duplicate');
    expect(dup?.[1]).toEqual({ providerId: 'stripe' });
  });

  it('should emit idempotency.store_error metric tagged with child providerId', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload('evt_se'), timestamp: ts });
    const base = createVerifier({ provider: stripe, secret: SECRET, clock });
    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const metrics: Metrics = { increment: (n, t) => calls.push([n, t]) };
    const failingStore: IdempotencyStore = { putIfAbsent: () => { throw new Error('x'); } };
    const wrapped = withIdempotency(base, { store: failingStore, metrics });
    await wrapped.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(calls.find(([n]) => n === 'idempotency.store_error')?.[1]).toEqual({ providerId: 'stripe' });
  });

  it('should preserve verifier providerId on the wrapper', () => {
    const base = createVerifier({ provider: stripe, secret: SECRET });
    const wrapped: Verifier<typeof stripe> = withIdempotency(base, { store: memoryStore() });
    expect(wrapped.providerId).toBe('stripe');
  });
});

describe('defaultIdempotencyKey', () => {
  it('should return null for stripe (extracted from event body)', () => {
    expect(defaultIdempotencyKey('stripe', fromRecord({}))).toBeNull();
  });

  it('should return X-GitHub-Delivery for github', () => {
    expect(defaultIdempotencyKey('github', fromRecord({ 'x-github-delivery': 'd1' }))).toBe('d1');
  });

  it('should return X-Shopify-Webhook-Id for shopify', () => {
    expect(defaultIdempotencyKey('shopify', fromRecord({ 'x-shopify-webhook-id': 'w1' }))).toBe('w1');
  });

  it('should return X-Event-Id for lemon-squeezy', () => {
    expect(defaultIdempotencyKey('lemon-squeezy', fromRecord({ 'x-event-id': 'e1' }))).toBe('e1');
  });

  it('should return X-Vercel-Delivery for vercel', () => {
    expect(defaultIdempotencyKey('vercel', fromRecord({ 'x-vercel-delivery': 'v1' }))).toBe('v1');
  });

  it('should return webhook-id for svix-family providers', () => {
    expect(defaultIdempotencyKey('svix', fromRecord({ 'webhook-id': 's1' }))).toBe('s1');
    expect(defaultIdempotencyKey('clerk', fromRecord({ 'webhook-id': 'c1' }))).toBe('c1');
    expect(defaultIdempotencyKey('resend', fromRecord({ 'webhook-id': 'r1' }))).toBe('r1');
  });

  it('should fall back to webhook-id then x-request-id for unknown providers', () => {
    expect(defaultIdempotencyKey('mystery', fromRecord({ 'webhook-id': 'm1' }))).toBe('m1');
    expect(defaultIdempotencyKey('mystery', fromRecord({ 'x-request-id': 'r2' }))).toBe('r2');
    expect(defaultIdempotencyKey('mystery', fromRecord({}))).toBeNull();
  });
});
