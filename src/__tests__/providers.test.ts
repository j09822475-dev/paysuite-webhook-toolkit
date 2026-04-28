import { describe, expect, it } from 'vitest';
import { createVerifier } from '../core/verifier.js';
import { fakeClock } from '../testing/fake-clock.js';
import { signWith } from '../testing/sign.js';
import { utf8, hex, base64 } from '../core/encoding.js';

import { stripe } from '../providers/stripe.js';
import { github } from '../providers/github.js';
import { shopify } from '../providers/shopify.js';
import { twilio } from '../providers/twilio.js';
import { slack } from '../providers/slack.js';
import { svix, svixStyleProvider, buildSvixSigningString } from '../providers/svix.js';
import { clerk } from '../providers/clerk.js';
import { resend } from '../providers/resend.js';
import { linear } from '../providers/linear.js';
import { vercel } from '../providers/vercel.js';
import { lemonSqueezy } from '../providers/lemon-squeezy.js';
import { paddle } from '../providers/paddle.js';
import { square } from '../providers/square.js';
import { discord } from '../providers/discord.js';
import { sendgrid } from '../providers/sendgrid.js';
import { mailgun } from '../providers/mailgun.js';
import { postmark, verifyPostmarkBasicAuth } from '../providers/postmark.js';
import { stripeStyleSignature } from '../providers/_shared/stripe-style.js';
import { svixStyleSignature } from '../providers/_shared/svix-style.js';
import { simpleHmacProvider } from '../providers/_shared/hmac-provider.js';
import { hmacSha256, normalizeEd25519PublicKey } from '../core/crypto.js';
import { fromRecord } from '../core/headers.js';

const SECRET = 'whsec_test';

const fixedClock = (): ReturnType<typeof fakeClock> => fakeClock(1_700_000_000_000);

describe('stripe provider', () => {
  it('should verify a freshly signed payload', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const signed = await signWith(stripe, {
      secret: SECRET,
      payload: { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 1, currency: 'usd', status: 'ok' } } },
      timestamp: ts,
    });
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return null parseSignature when header missing', () => {
    expect(stripe.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return null when stripe-signature contains no v1 entries', () => {
    expect(stripe.parseSignature(fromRecord({ 'stripe-signature': 't=1' }))).toBeNull();
  });

  it('should return null extractTimestamp when header missing', () => {
    expect(stripe.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should return ms timestamp from t= field', () => {
    expect(stripe.extractTimestamp(fromRecord({ 'stripe-signature': 't=100,v1=ab' }), new Uint8Array(0))).toBe(100_000);
  });

  it('should return null timestamp when t= is non-finite', () => {
    expect(stripe.extractTimestamp(fromRecord({ 'stripe-signature': 't=abc,v1=ab' }), new Uint8Array(0))).toBeNull();
  });

  it('should extract event.id as idempotency key', () => {
    const event = { id: 'evt_x', type: 'payment_intent.succeeded', data: { object: { id: 'pi', amount: 1, currency: 'u', status: 's' } } } as const;
    expect(stripe.idempotencyKey!({} as never, event)).toBe('evt_x');
  });
});

describe('github provider', () => {
  it('should verify a signed payload', async () => {
    const signed = await signWith(github, { secret: SECRET, payload: '{"ref":"main"}' });
    const v = createVerifier({ provider: github, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should accept hex without sha256= prefix when present', () => {
    const parsed = github.parseSignature(fromRecord({ 'x-hub-signature-256': hex.encode(new Uint8Array(32)) }));
    expect(parsed?.signatures[0]?.length).toBe(32);
  });

  it('should return null when header missing', () => {
    expect(github.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should never extract a timestamp', () => {
    expect(github.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should use X-GitHub-Delivery as idempotency key', async () => {
    const signed = await signWith(github, { secret: SECRET, payload: '{}', webhookId: 'd-test' });
    const v = createVerifier({ provider: github, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    if (!result.ok) throw result.error;
    expect(result.idempotencyKey).toBe('github:d-test');
  });
});

describe('shopify provider', () => {
  it('should verify a signed payload', async () => {
    const signed = await signWith(shopify, { secret: SECRET, payload: '{"id":1}' });
    const v = createVerifier({ provider: shopify, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return null when header missing', () => {
    expect(shopify.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should not extract a timestamp', () => {
    expect(shopify.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });
});

describe('twilio provider', () => {
  it('should verify a signed form-encoded payload with URL-aware signing', async () => {
    const url = 'https://example.test/twilio';
    const body = 'MessageSid=SM1&Body=hello';
    const signed = await signWith(twilio, { secret: SECRET, payload: body, url });
    const v = createVerifier({ provider: twilio, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody, url });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('twilio:SM1');
  });

  it('should parse JSON body when Content-Type is JSON-shaped', async () => {
    const url = 'https://example.test/twilio';
    const body = '{"MessageSid":"SM2"}';
    const signed = await signWith(twilio, { secret: SECRET, payload: body, url });
    const v = createVerifier({ provider: twilio, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody, url });
    expect(result.ok).toBe(true);
  });

  it('should return null parseSignature when header missing', () => {
    expect(twilio.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return empty event when rawBody is empty', () => {
    expect(twilio.parseEvent(new Uint8Array(0))).toEqual({});
  });

  it('should never extract a timestamp', () => {
    expect(twilio.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });
});

describe('slack provider', () => {
  it('should verify a signed JSON payload', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ event_id: 'ev1', type: 'event_callback' });
    const signed = await signWith(slack, { secret: SECRET, payload, timestamp: ts });
    const v = createVerifier({ provider: slack, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should parse a urlencoded payload= form body', () => {
    const body = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_actions' }));
    const event = slack.parseEvent(utf8.encode(body));
    expect(event.type).toBe('block_actions');
  });

  it('should parse a urlencoded body without payload= as a flat object', () => {
    const body = 'a=1&b=2';
    expect(slack.parseEvent(utf8.encode(body))).toMatchObject({ a: '1', b: '2' });
  });

  it('should return null parseSignature when header missing', () => {
    expect(slack.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return null timestamp when header missing', () => {
    expect(slack.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });
});

describe('svix-style providers (svix/clerk/resend)', () => {
  it.each([
    ['svix', svix],
    ['clerk', clerk],
    ['resend', resend],
  ])('should verify a signed Svix-style payload for %s', async (_id, provider) => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ type: 'user.created', data: { id: 'u1' } });
    const signed = await signWith(provider, { secret: SECRET, payload, timestamp: ts });
    const v = createVerifier({ provider, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should return null parseSignature when webhook-signature header is missing', () => {
    expect(svix.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return null parseSignature when header has no usable v1 entries', () => {
    expect(svix.parseSignature(fromRecord({ 'webhook-signature': 'v2,xxx' }))).toBeNull();
  });

  it('should return null timestamp when header is missing', () => {
    expect(svix.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should expose buildSvixSigningString helper that concatenates id.ts.body', () => {
    const built = buildSvixSigningString({
      rawBody: utf8.encode('body'),
      timestamp: 100_000,
      headers: fromRecord({ 'webhook-id': 'msg_1' }),
    });
    expect(utf8.decode(built)).toBe('msg_1.100.body');
  });

  it('should allow building a custom-id provider via svixStyleProvider', () => {
    const p = svixStyleProvider('my-svix');
    expect(p.id).toBe('my-svix');
  });
});

describe('linear provider', () => {
  it('should verify a signed payload via linear-signature header', async () => {
    const signed = await signWith(linear, { secret: SECRET, payload: '{"action":"create"}' });
    const v = createVerifier({ provider: linear, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });

  it('should fall back to event.delivery for idempotency key', async () => {
    const signed = await signWith(linear, { secret: SECRET, payload: JSON.stringify({ delivery: 'd1' }) });
    const v = createVerifier({ provider: linear, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    if (!result.ok) throw result.error;
    expect(result.idempotencyKey).toBe('linear:d1');
  });
});

describe('vercel provider', () => {
  it('should verify a signed payload (HMAC-SHA1)', async () => {
    const signed = await signWith(vercel, { secret: SECRET, payload: '{"type":"deployment"}' });
    const v = createVerifier({ provider: vercel, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toMatch(/^vercel:/);
  });
});

describe('lemonSqueezy provider', () => {
  it('should verify a signed payload via x-signature', async () => {
    const signed = await signWith(lemonSqueezy, { secret: SECRET, payload: '{"meta":{"event_name":"order_created"}}' });
    const v = createVerifier({ provider: lemonSqueezy, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toMatch(/^lemon-squeezy:/);
  });
});

describe('paddle provider', () => {
  it('should verify a signed payload via paddle-signature header', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ notification_id: 'ntf_1', event_type: 'subscription.updated' });
    const signed = await signWith(paddle, { secret: SECRET, payload, timestamp: ts });
    const v = createVerifier({ provider: paddle, secret: SECRET, clock });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('paddle:ntf_1');
  });

  it('should return null when paddle-signature header is missing', () => {
    expect(paddle.parseSignature(fromRecord({}))).toBeNull();
    expect(paddle.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should return null when header has no h1 entries', () => {
    expect(paddle.parseSignature(fromRecord({ 'paddle-signature': 'ts=1' }))).toBeNull();
  });

  it('should skip malformed h1 entries and accept the valid one', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const payload = JSON.stringify({ notification_id: 'n', event_type: 'x' });
    const signed = await signWith(paddle, { secret: SECRET, payload, timestamp: ts });
    // Inject a bad h1 alongside the good one.
    const bad = signed.headers['paddle-signature']! + ';h1=not-hex!';
    const v = createVerifier({ provider: paddle, secret: SECRET, clock });
    const result = await v.verify({ headers: { 'paddle-signature': bad }, rawBody: signed.rawBody });
    expect(result.ok).toBe(true);
  });
});

describe('square provider', () => {
  it('should verify a signed payload using URL+body', async () => {
    const url = 'https://example.test/square';
    const payload = JSON.stringify({ event_id: 'sq1', type: 'payment.created' });
    const signed = await signWith(square, { secret: SECRET, payload, url });
    const v = createVerifier({ provider: square, secret: SECRET });
    const result = await v.verify({ headers: signed.headers, rawBody: signed.rawBody, url });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('square:sq1');
  });
});

describe('discord provider (Ed25519)', () => {
  it('should verify a real Ed25519 signature', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

    const payload = JSON.stringify({ id: 'i1', type: 1 });
    const rawBody = utf8.encode(payload);
    const signedBytes = utf8.encode(String(ts));
    const data = new Uint8Array(signedBytes.length + rawBody.length);
    data.set(signedBytes, 0);
    data.set(rawBody, signedBytes.length);
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));

    const v = createVerifier({ provider: discord, secret: rawPub, clock });
    const result = await v.verify({
      headers: {
        'x-signature-ed25519': hex.encode(sig),
        'x-signature-timestamp': String(ts),
      },
      rawBody,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('discord:i1');
  });

  it('should reject a tampered Ed25519 signature', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    const rawBody = utf8.encode('{}');
    const data = new Uint8Array(String(ts).length + rawBody.length);
    data.set(utf8.encode(String(ts)), 0);
    data.set(rawBody, String(ts).length);
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));
    sig[0] ^= 0xff;

    const v = createVerifier({ provider: discord, secret: rawPub, clock });
    const result = await v.verify({
      headers: { 'x-signature-ed25519': hex.encode(sig), 'x-signature-timestamp': String(ts) },
      rawBody,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISMATCH');
  });

  it('should return null parseSignature when ed25519 header is missing', () => {
    expect(discord.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return null extractTimestamp when timestamp header is missing', () => {
    expect(discord.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });
});

describe('sendgrid provider (Ed25519)', () => {
  it('should verify a real Ed25519 signature', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    const rawBody = utf8.encode('[{"event":"delivered"}]');
    const data = new Uint8Array(String(ts).length + rawBody.length);
    data.set(utf8.encode(String(ts)), 0);
    data.set(rawBody, String(ts).length);
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));

    const v = createVerifier({ provider: sendgrid, secret: rawPub, clock });
    const result = await v.verify({
      headers: {
        'x-twilio-email-event-webhook-signature': base64.encode(sig),
        'x-twilio-email-event-webhook-timestamp': String(ts),
      },
      rawBody,
    });
    expect(result.ok).toBe(true);
  });

  it('should return null parseSignature when header missing', () => {
    expect(sendgrid.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should return null extractTimestamp when header missing', () => {
    expect(sendgrid.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });
});

describe('mailgun provider', () => {
  it('should verify body-signed payload', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const token = 'tok_123';
    const sigHex = hex.encode(await hmacSha256(utf8.encode(SECRET), utf8.encode(`${String(ts)}${token}`)));
    const body = JSON.stringify({
      signature: { token, timestamp: String(ts), signature: sigHex },
      'event-data': { id: 'mg-evt-1', event: 'delivered' },
    });
    const v = createVerifier({ provider: mailgun, secret: SECRET, clock });
    const result = await v.verify({ headers: {}, rawBody: utf8.encode(body) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('mailgun:tok_123');
  });

  it('should return null timestamp when body lacks signature', () => {
    expect(mailgun.extractTimestamp(fromRecord({}), utf8.encode('not-json'))).toBeNull();
    expect(mailgun.extractTimestamp(fromRecord({}), utf8.encode('{}'))).toBeNull();
  });

  it('should reject when body signature is malformed hex', async () => {
    const clock = fixedClock();
    const ts = Math.floor(clock.now() / 1000);
    const body = JSON.stringify({
      signature: { token: 't', timestamp: String(ts), signature: 'NOT-HEX!' },
    });
    const v = createVerifier({ provider: mailgun, secret: SECRET, clock });
    const result = await v.verify({ headers: {}, rawBody: utf8.encode(body) });
    expect(result.ok).toBe(false);
  });

  it('should reject when signature object missing required keys', async () => {
    const clock = fixedClock();
    const v = createVerifier({ provider: mailgun, secret: SECRET, clock, tolerance: Infinity });
    const result = await v.verify({ headers: {}, rawBody: utf8.encode('{"signature":{"token":"t"}}') });
    expect(result.ok).toBe(false);
  });
});

describe('postmark provider', () => {
  it('verifyPostmarkBasicAuth should return true for matching credentials', () => {
    const auth = 'Basic ' + Buffer.from('user:pass').toString('base64');
    expect(verifyPostmarkBasicAuth({ headers: fromRecord({ authorization: auth }), user: 'user', pass: 'pass' })).toBe(true);
  });

  it('verifyPostmarkBasicAuth should return false when no Authorization header', () => {
    expect(verifyPostmarkBasicAuth({ headers: fromRecord({}), user: 'u', pass: 'p' })).toBe(false);
  });

  it('verifyPostmarkBasicAuth should return false on wrong credentials', () => {
    const auth = 'Basic ' + Buffer.from('user:wrong').toString('base64');
    expect(verifyPostmarkBasicAuth({ headers: fromRecord({ authorization: auth }), user: 'user', pass: 'pass' })).toBe(false);
  });

  it('verifyPostmarkBasicAuth should return false for non-Basic auth scheme', () => {
    expect(verifyPostmarkBasicAuth({ headers: fromRecord({ authorization: 'Bearer xyz' }), user: 'u', pass: 'p' })).toBe(false);
  });

  it('postmark provider should verify when secret is "user:pass" and header matches', async () => {
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const v = createVerifier({ provider: postmark, secret: 'u:p' });
    const result = await v.verify({
      headers: { authorization: auth },
      rawBody: utf8.encode('{"MessageID":"m1"}'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.idempotencyKey).toBe('postmark:m1');
  });

  it('postmark provider should reject when secret has no colon', async () => {
    const auth = 'Basic ' + Buffer.from('u:p').toString('base64');
    const v = createVerifier({ provider: postmark, secret: 'no-colon-here' });
    const result = await v.verify({
      headers: { authorization: auth },
      rawBody: utf8.encode('{}'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SIGNATURE_MISMATCH');
  });

  it('postmark provider parseSignature returns null when no Basic auth header', () => {
    expect(postmark.parseSignature(fromRecord({}))).toBeNull();
    expect(postmark.parseSignature(fromRecord({ authorization: 'Bearer x' }))).toBeNull();
  });
});

describe('_shared/stripe-style', () => {
  it('should parse a multi-v1 header into ordered arrays', () => {
    const parsed = stripeStyleSignature.parse('t=42,v1=abcd,v1=ef01,v0=ff');
    expect(parsed.t).toBe(42);
    expect(parsed.v1).toEqual(['abcd', 'ef01']);
    expect(parsed.v0).toEqual(['ff']);
  });

  it('should set t=null when t value is non-numeric', () => {
    expect(stripeStyleSignature.parse('t=abc,v1=x').t).toBeNull();
  });

  it('should ignore parts without an = separator', () => {
    expect(stripeStyleSignature.parse('garbage,t=1,v1=ab').t).toBe(1);
  });

  it('should memoize identical headers across calls', () => {
    const a = stripeStyleSignature.parse('t=1,v1=ab');
    const b = stripeStyleSignature.parse('t=1,v1=ab');
    expect(b).toBe(a);
  });

  it('should evict old entries when over PARSE_CACHE_MAX', () => {
    // Fill the cache beyond capacity (256). This exercises the LRU branch.
    for (let i = 0; i < 300; i++) stripeStyleSignature.parse(`t=${String(i)},v1=ab`);
    // Then re-parse one — must still produce correct output.
    const result = stripeStyleSignature.parse('t=999,v1=cd');
    expect(result.t).toBe(999);
  });
});

describe('_shared/svix-style', () => {
  it('should decode multiple space-separated v1 entries', () => {
    const sigs = svixStyleSignature.parse('v1,' + base64.encode(new Uint8Array([1, 2])) + ' v1,' + base64.encode(new Uint8Array([3])));
    expect(sigs).toHaveLength(2);
  });

  it('should skip malformed base64 entries silently', () => {
    const sigs = svixStyleSignature.parse('v1,!!!! v1,' + base64.encode(new Uint8Array([1])));
    expect(sigs).toHaveLength(1);
  });

  it('should skip non-v1 prefixes', () => {
    expect(svixStyleSignature.parse('v2,' + base64.encode(new Uint8Array([1])))).toEqual([]);
  });

  it('should skip parts without a comma', () => {
    expect(svixStyleSignature.parse('garbage')).toEqual([]);
  });
});

describe('_shared/hmac-provider', () => {
  it('should build provider that strips signaturePrefix when present', async () => {
    const p = simpleHmacProvider({
      id: 'gen',
      algorithm: 'HMAC-SHA256',
      signatureHeader: 'x-sig',
      signaturePrefix: 'sha256=',
    });
    const parsed = p.parseSignature(fromRecord({ 'x-sig': 'sha256=' + hex.encode(new Uint8Array(32)) }));
    expect(parsed?.signatures[0]?.length).toBe(32);
  });

  it('should support base64 / base64url encodings', () => {
    const b = simpleHmacProvider({ id: 'b', algorithm: 'HMAC-SHA256', signatureHeader: 'x-s', signatureEncoding: 'base64' });
    const u = simpleHmacProvider({ id: 'u', algorithm: 'HMAC-SHA256', signatureHeader: 'x-s', signatureEncoding: 'base64url' });
    expect(b.parseSignature(fromRecord({ 'x-s': base64.encode(new Uint8Array([1, 2])) }))?.signatures[0]?.length).toBe(2);
    expect(u.parseSignature(fromRecord({ 'x-s': '__-' }))?.signatures[0]).toBeInstanceOf(Uint8Array);
  });

  it('should return null parseSignature when header missing', () => {
    const p = simpleHmacProvider({ id: 'g', algorithm: 'HMAC-SHA256', signatureHeader: 'x-sig' });
    expect(p.parseSignature(fromRecord({}))).toBeNull();
  });

  it('should treat timestampUnit milliseconds as unscaled', () => {
    const p = simpleHmacProvider({
      id: 'g',
      algorithm: 'HMAC-SHA256',
      signatureHeader: 'x-sig',
      timestampHeader: 'x-ts',
      timestampUnit: 'milliseconds',
    });
    expect(p.extractTimestamp(fromRecord({ 'x-ts': '1700' }), new Uint8Array(0))).toBe(1700);
  });

  it('should treat timestampUnit seconds as multiplied by 1000', () => {
    const p = simpleHmacProvider({
      id: 'g',
      algorithm: 'HMAC-SHA256',
      signatureHeader: 'x-sig',
      timestampHeader: 'x-ts',
    });
    expect(p.extractTimestamp(fromRecord({ 'x-ts': '5' }), new Uint8Array(0))).toBe(5000);
  });

  it('should return null timestamp when no timestampHeader', () => {
    const p = simpleHmacProvider({ id: 'g', algorithm: 'HMAC-SHA256', signatureHeader: 'x-sig' });
    expect(p.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should return null timestamp when value is not finite', () => {
    const p = simpleHmacProvider({ id: 'g', algorithm: 'HMAC-SHA256', signatureHeader: 'x-sig', timestampHeader: 'x-ts' });
    expect(p.extractTimestamp(fromRecord({ 'x-ts': 'abc' }), new Uint8Array(0))).toBeNull();
  });

  it('should return null timestamp when value is missing', () => {
    const p = simpleHmacProvider({ id: 'g', algorithm: 'HMAC-SHA256', signatureHeader: 'x-sig', timestampHeader: 'x-ts' });
    expect(p.extractTimestamp(fromRecord({}), new Uint8Array(0))).toBeNull();
  });

  it('should accept a custom parseEvent', () => {
    const p = simpleHmacProvider<{ value: string }>({
      id: 'g',
      algorithm: 'HMAC-SHA256',
      signatureHeader: 'x-sig',
      parseEvent: (raw) => ({ value: utf8.decode(raw) }),
    });
    expect(p.parseEvent(utf8.encode('hello'))).toEqual({ value: 'hello' });
  });
});

describe('Ed25519 normalization smoke test (used by discord/sendgrid)', () => {
  it('should normalize a raw 32-byte key without throwing', () => {
    const k = new Uint8Array(32);
    expect(normalizeEd25519PublicKey(k).length).toBe(32);
  });
});
