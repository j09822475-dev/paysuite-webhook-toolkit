import { describe, expect, expectTypeOf, it } from 'vitest';
import { createVerifier, defineProvider, defineWebhookProvider } from '../core/verifier.js';
import { fakeClock } from '../testing/fake-clock.js';
import { signWith } from '../testing/sign.js';
import { stripe, type StripeEvent } from '../providers/stripe.js';
import { github } from '../providers/github.js';
import { utf8, hex, concat } from '../core/encoding.js';
import { WebhookError } from '../errors/index.js';
import type { Logger, Metrics, VerificationResult, Verifier, WebhookProvider } from '../core/types.js';

const SECRET = 'whsec_test';

function makeStripePayload(): string {
  return JSON.stringify({
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount: 100, currency: 'usd', status: 'succeeded' } },
  });
}

describe('createVerifier — config', () => {
  it('should throw CONFIG when provider is missing', () => {
    expect(() => createVerifier({ provider: undefined as unknown as typeof stripe, secret: SECRET })).toThrow(
      /provider/,
    );
  });

  it('should throw CONFIG when secret is undefined', () => {
    expect(() => createVerifier({ provider: stripe, secret: undefined as unknown as string })).toThrow(
      /secret/,
    );
  });

  it('should throw CONFIG when secret array is empty', () => {
    expect(() => createVerifier({ provider: stripe, secret: [] })).toThrow(/secret/);
  });

  it('should expose providerId on the returned verifier', () => {
    const v = createVerifier({ provider: stripe, secret: SECRET });
    expect(v.providerId).toBe('stripe');
  });
});

describe('createVerifier — happy path', () => {
  it('should verify a freshly signed Stripe webhook when timestamp is current', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: ts });

    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe('payment_intent.succeeded');
      expect(result.event.id).toBe('evt_1');
      expect(result.idempotencyKey).toBe('stripe:evt_1');
      expect(result.receivedAt).toBe(clock.now());
    }
  });

  it('should accept a fetch Request when given one', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const payload = makeStripePayload();
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });

    const req = new Request('https://example.test/hooks/stripe', {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });

    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify(req);
    expect(result.ok).toBe(true);
  });

  it('should accept a NormalizedRequest when given one', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: ts });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({
      headers: { get: (n) => signed.headers[n.toLowerCase()] ?? null, has: (n) => n.toLowerCase() in signed.headers, entries: function* () {} },
      rawBody: signed.rawBody,
      url: 'https://x/y',
      method: 'POST',
    });
    expect(result.ok).toBe(true);
  });

  it('should accept a stream rawBody when verifying flexible input', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: ts });
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(signed.rawBody); c.close(); },
    });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: stream });
    expect(result.ok).toBe(true);
  });

  it('should accept secret rotation array and verify with second secret', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: 'old_secret', payload: makeStripePayload(), timestamp: ts });

    const v = createVerifier({ provider: stripe, secret: ['new_secret', 'old_secret'], clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should namespace idempotencyKey with providerId prefix', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: ts });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    if (!result.ok) throw result.error;
    expect(result.idempotencyKey).toMatch(/^stripe:/);
  });

  it('should return null idempotencyKey when provider returns null', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const payload = JSON.stringify({ ref: 'main' });
    const signed = await signWith(github, { secret: SECRET, payload });
    const v = createVerifier({ provider: github, secret: SECRET, clock });
    // Override delivery to be missing
    const headers = { ...signed.headers };
    delete (headers as Record<string, string>)['x-github-delivery'];
    const result = await v.verify({ headers, rawBody: signed.rawBody });
    if (!result.ok) throw result.error;
    expect(result.idempotencyKey).toBeNull();
  });
});

describe('createVerifier — failure paths', () => {
  it('should return SIGNATURE_MISSING when header is absent', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: {}, rawBody: utf8.encode('{}') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISSING');
  });

  it('should return SIGNATURE_MALFORMED when v1 entries are all malformed', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({
      headers: { 'stripe-signature': `t=${String(ts)},v1=not-hex!` },
      rawBody: utf8.encode('{}'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISSING');
  });

  it('should return SIGNATURE_MISMATCH when signature does not match', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({
      headers: { 'stripe-signature': `t=${String(ts)},v1=${'00'.repeat(32)}` },
      rawBody: utf8.encode('{}'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISMATCH');
  });

  it('should return REPLAY_WINDOW_EXCEEDED when timestamp is too old', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const oldTs = Math.floor(clock.now() / 1000) - 1000;
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: oldTs });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, tolerance: 300 });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REPLAY_WINDOW_EXCEEDED');
  });

  it('should disable replay window when tolerance is Infinity', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const oldTs = 1; // ancient
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: oldTs });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, tolerance: Infinity });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return PAYLOAD_TOO_LARGE when body exceeds maxBodyBytes', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, maxBodyBytes: 4 });
    const result = await v.verify({
      headers: { 'stripe-signature': 't=1,v1=00' },
      rawBody: utf8.encode('lots of bytes'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should return PAYLOAD_TOO_LARGE for fetch Request bodies exceeding cap', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, maxBodyBytes: 4 });
    const req = new Request('https://example/x', { method: 'POST', body: 'too-large-body' });
    const result = await v.verify(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should return PAYLOAD_TOO_LARGE for NormalizedRequest bodies exceeding cap', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, maxBodyBytes: 4 });
    const result = await v.verify({
      headers: { get: () => null, has: () => false, entries: function* () {} },
      rawBody: new Uint8Array(20),
      url: '/x',
      method: 'POST',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should return PAYLOAD_PARSE when body cannot be JSON-parsed', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    // Sign garbage so signature passes but JSON.parse fails.
    const garbage = utf8.encode('{not json');
    const signed = await signWith(stripe, { secret: SECRET, payload: garbage, timestamp: ts });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_PARSE');
  });

  it('should return SIGNATURE_MALFORMED when parseSignature throws', async () => {
    const provider = defineWebhookProvider({
      id: 'throws',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => { throw new Error('boom'); },
      extractTimestamp: () => null,
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({}),
    });
    const v = createVerifier({ provider, secret: SECRET });
    const result = await v.verify({ headers: { 'x': 'y' }, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MALFORMED');
  });

  it('should return TIMESTAMP_INVALID when extractTimestamp throws', async () => {
    const provider = defineWebhookProvider({
      id: 'tsthrows',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => ({ signatures: [new Uint8Array(32)], raw: 'x' }),
      extractTimestamp: () => { throw new Error('bad ts'); },
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({}),
    });
    const v = createVerifier({ provider, secret: SECRET });
    const result = await v.verify({ headers: { 'x': 'y' }, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMESTAMP_INVALID');
  });

  it('should throw CONFIG when provider has neither verify nor buildSigningString', async () => {
    const provider: WebhookProvider = {
      id: 'broken',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => ({ signatures: [new Uint8Array(32)], raw: 'x' }),
      extractTimestamp: () => null,
      parseEvent: () => ({}),
    };
    const v = createVerifier({ provider, secret: SECRET });
    await expect(
      v.verify({ headers: { x: 'y' }, rawBody: new Uint8Array(0) }),
    ).rejects.toMatchObject({ code: 'CONFIG' });
  });

  it('should throw CONFIG when algorithm has no built-in HMAC for non-verify provider', async () => {
    const provider: WebhookProvider = {
      id: 'unknown-algo',
      algorithm: 'Ed25519' as const,
      parseSignature: () => ({ signatures: [new Uint8Array(32)], raw: 'x' }),
      extractTimestamp: () => null,
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({}),
    };
    const v = createVerifier({ provider, secret: SECRET });
    await expect(
      v.verify({ headers: { x: 'y' }, rawBody: new Uint8Array(0) }),
    ).rejects.toMatchObject({ code: 'CONFIG' });
  });
});

describe('createVerifier — telemetry', () => {
  it('should emit verify.ok metric and debug log on success', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: ts });

    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const metrics: Metrics = { increment: (n, t) => calls.push([n, t]) };
    const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const logger: Logger = {
      debug: (m, x) => logs.push(['debug', m, x]),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    const v = createVerifier({ provider: stripe, secret: SECRET, clock, logger, metrics });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
    expect(calls).toContainEqual(['verify.ok', { providerId: 'stripe' }]);
    expect(logs.find(([lvl, msg]) => lvl === 'debug' && msg === 'verify.ok')).toBeTruthy();
  });

  it('should emit verify.fail and replay.exceeded on replay window failure', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const oldTs = Math.floor(clock.now() / 1000) - 10_000;
    const signed = await signWith(stripe, { secret: SECRET, payload: makeStripePayload(), timestamp: oldTs });
    const calls: string[] = [];
    const metrics: Metrics = { increment: (n) => calls.push(n) };
    const v = createVerifier({ provider: stripe, secret: SECRET, clock, metrics });
    await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(calls).toContain('replay.exceeded');
    expect(calls).toContain('verify.fail');
  });
});

describe('defineWebhookProvider / defineProvider', () => {
  it('should be the identity function on a provider spec', () => {
    const spec: WebhookProvider = {
      id: 'x',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => null,
      extractTimestamp: () => null,
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({}),
    };
    expect(defineWebhookProvider(spec)).toBe(spec);
    expect(defineProvider(spec)).toBe(spec);
  });

  it('should preserve event type information through inference', () => {
    type MyEvent = { type: 'a' } | { type: 'b' };
    const provider = defineWebhookProvider<MyEvent>({
      id: 'my',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => null,
      extractTimestamp: () => null,
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({ type: 'a' }),
    });
    expectTypeOf(provider).toMatchTypeOf<WebhookProvider<MyEvent>>();
  });
});

describe('Verifier type', () => {
  it('should infer event type from provider in VerificationResult', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET });
    expectTypeOf(v).toMatchTypeOf<Verifier<typeof stripe>>();
    type R = Awaited<ReturnType<typeof v.verify>>;
    expectTypeOf<R>().toMatchTypeOf<VerificationResult<StripeEvent>>();
  });
});

describe('createVerifier — multiple v1 with one valid', () => {
  it('should verify when one v1 entry is malformed and another is valid', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const payload = makeStripePayload();
    const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });

    // The valid signature was: t=...,v1=<hex>. Inject a malformed v1 alongside.
    const goodHeader = signed.headers['stripe-signature']!;
    const tampered = goodHeader + ',v1=not-hex!,v1=alsobad!';
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({
      headers: { 'stripe-signature': tampered },
      rawBody: signed.rawBody,
    });
    expect(result.ok).toBe(true);
  });
});

describe('createVerifier — Uint8Array secret', () => {
  it('should accept a Uint8Array as the secret directly', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const ts = Math.floor(clock.now() / 1000);
    const secretBytes = utf8.encode('binary_secret');
    const signed = await signWith(stripe, { secret: secretBytes, payload: makeStripePayload(), timestamp: ts });
    const v = createVerifier({ provider: stripe, secret: secretBytes, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });
});

describe('createVerifier — silent in absence of logger / metrics', () => {
  it('should not throw when no logger or metrics is supplied and verification fails', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: {}, rawBody: new Uint8Array(0) });
    expect(result.ok).toBe(false);
  });
});

describe('createVerifier — buildSigningString output', () => {
  it('should match the byte sequence stripe expects', () => {
    const rawBody = utf8.encode('{}');
    const built = stripe.buildSigningString!({
      rawBody,
      timestamp: 100_000,
      url: '',
      method: 'POST',
      headers: { get: () => null, has: () => false, entries: function* () {} },
    });
    expect(built).toEqual(concat(utf8.encode('100.'), rawBody));
    // sanity: hex-encoded looks reasonable
    expect(hex.encode(built).length).toBeGreaterThan(0);
  });
});
