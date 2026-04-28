import { describe, expect, it } from 'vitest';
import { createMultiVerifier } from '../core/multi-verifier.js';
import { createVerifier } from '../core/verifier.js';
import { stripe } from '../providers/stripe.js';
import { github } from '../providers/github.js';
import { signWith } from '../testing/sign.js';
import { fakeClock } from '../testing/fake-clock.js';
import { utf8 } from '../core/encoding.js';

const SECRET = 'whsec_test';

function makeMulti(clock = fakeClock(1_700_000_000_000)) {
  return {
    clock,
    multi: createMultiVerifier({
      stripe: createVerifier({ provider: stripe, secret: SECRET, clock }),
      github: createVerifier({ provider: github, secret: SECRET, clock }),
    }),
  };
}

describe('createMultiVerifier — config', () => {
  it('should throw CONFIG when given empty verifiers map', () => {
    expect(() => createMultiVerifier({} as never)).toThrow(/at least one/);
  });

  it('should expose providerId as "multi" on the wrapper', () => {
    const { multi } = makeMulti();
    expect(multi.providerId).toBe('multi');
  });
});

describe('createMultiVerifier — by-path dispatch (default)', () => {
  it('should dispatch to the child whose key matches the last URL path segment', async () => {
    const { clock, multi } = makeMulti();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x', amount: 1, currency: 'usd', status: 'ok' } } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });

    const req = new Request('https://example.test/webhooks/stripe', {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });
    const result = await multi.verify(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.providerId).toBe('stripe');
    }
  });

  it('should return SIGNATURE_MISSING when path does not match any verifier', async () => {
    const { multi } = makeMulti();
    const result = await multi.verify({
      headers: {},
      rawBody: new Uint8Array(0),
      url: 'https://example/no-such-route',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISSING');
  });

  it('should treat trailing slashes as not changing the resolved segment', async () => {
    const { clock, multi } = makeMulti();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'x', data: { object: {} } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
    const result = await multi.verify({
      headers: signed.headers,
      rawBody: signed.rawBody,
      url: 'https://example/webhooks/stripe///',
    });
    // Path resolves to "stripe", so dispatch succeeds (signature still verifies).
    expect(result.ok).toBe(true);
  });
});

describe('createMultiVerifier — by-header dispatch', () => {
  it('should dispatch using x-webhook-provider when configured', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET, clock }) },
      { dispatch: 'by-header' },
    );
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'x', data: { object: {} } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
    const result = await multi.verify({
      headers: { ...signed.headers, 'x-webhook-provider': 'stripe' },
      rawBody: signed.rawBody,
    });
    expect(result.ok).toBe(true);
  });

  it('should accept a custom headerName for header dispatch', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET, clock }) },
      { dispatch: 'by-header', headerName: 'x-which' },
    );
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'x', data: { object: {} } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
    const result = await multi.verify({
      headers: { ...signed.headers, 'x-which': 'stripe' },
      rawBody: signed.rawBody,
    });
    expect(result.ok).toBe(true);
  });
});

describe('createMultiVerifier — function dispatch', () => {
  it('should call the provided dispatch function and use its return value as key', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET, clock }) },
      { dispatch: () => 'stripe' },
    );
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'x', data: { object: {} } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
    const result = await multi.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return SIGNATURE_MISSING when dispatch function returns null', async () => {
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET }) },
      { dispatch: () => null },
    );
    const result = await multi.verify({ headers: {}, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISSING');
  });
});

describe('createMultiVerifier — body cap', () => {
  it('should enforce maxBodyBytes before dispatching to the child', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET, clock }) },
      { maxBodyBytes: 4 },
    );
    const result = await multi.verify({
      headers: {},
      rawBody: utf8.encode('lots of bytes'),
      url: 'https://example/webhooks/stripe',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should enforce maxBodyBytes against fetch Request streams', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const multi = createMultiVerifier(
      { stripe: createVerifier({ provider: stripe, secret: SECRET, clock }) },
      { maxBodyBytes: 4 },
    );
    const req = new Request('https://example/webhooks/stripe', {
      method: 'POST',
      body: 'too-long-body',
    });
    const result = await multi.verify(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should propagate child verifier failure (e.g. SIGNATURE_MISMATCH)', async () => {
    const { clock, multi } = makeMulti();
    const ts = Math.floor(clock.now() / 1000);
    const result = await multi.verify({
      headers: { 'stripe-signature': `t=${String(ts)},v1=` + '00'.repeat(32) },
      rawBody: utf8.encode('{}'),
      url: 'https://example/hooks/stripe',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISMATCH');
  });
});

describe('createMultiVerifier — non-Request input fallback', () => {
  it('should accept a flexible input object with rawBody Uint8Array and url', async () => {
    const { clock, multi } = makeMulti();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ id: 'e', type: 'x', data: { object: {} } });
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
    const result = await multi.verify({
      headers: signed.headers,
      rawBody: signed.rawBody,
      url: 'https://example/hooks/stripe',
    });
    expect(result.ok).toBe(true);
  });
});
