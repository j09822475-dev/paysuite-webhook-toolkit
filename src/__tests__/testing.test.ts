import { describe, expect, it } from 'vitest';
import { fakeClock } from '../testing/fake-clock.js';
import { signWith } from '../testing/sign.js';
import * as fixtures from '../testing/fixtures.js';
import { stripe } from '../providers/stripe.js';
import { discord } from '../providers/discord.js';
import { sendgrid } from '../providers/sendgrid.js';
import { mailgun } from '../providers/mailgun.js';
import { postmark } from '../providers/postmark.js';
import { defineWebhookProvider } from '../core/verifier.js';
import { utf8 } from '../core/encoding.js';

describe('fakeClock', () => {
  it('should return its initial value when newly created', () => {
    const c = fakeClock(123);
    expect(c.now()).toBe(123);
  });

  it('should default to 0 when no initial value supplied', () => {
    expect(fakeClock().now()).toBe(0);
  });

  it('should advance by the requested ms', () => {
    const c = fakeClock(100);
    c.advance(50);
    expect(c.now()).toBe(150);
  });

  it('should jump to absolute time when set is called', () => {
    const c = fakeClock(100);
    c.set(999);
    expect(c.now()).toBe(999);
  });
});

describe('signWith', () => {
  it('should accept Uint8Array payload as raw bytes', async () => {
    const out = await signWith(stripe, { secret: 'k', payload: utf8.encode('{}'), timestamp: 1 });
    expect(out.bodyText).toBe('{}');
  });

  it('should accept string payload as UTF-8', async () => {
    const out = await signWith(stripe, { secret: 'k', payload: 'hello', timestamp: 1 });
    expect(out.bodyText).toBe('hello');
  });

  it('should JSON.stringify object payloads', async () => {
    const out = await signWith(stripe, { secret: 'k', payload: { x: 1 }, timestamp: 1 });
    expect(out.bodyText).toBe('{"x":1}');
  });

  it('should JSON.stringify array payloads', async () => {
    const out = await signWith(stripe, { secret: 'k', payload: [1, 2], timestamp: 1 });
    expect(out.bodyText).toBe('[1,2]');
  });

  it('should default timestamp to floor(now/1000) when omitted', async () => {
    const out = await signWith(stripe, { secret: 'k', payload: '{}' });
    const tMatch = /t=(\d+)/.exec(out.headers['stripe-signature']!);
    expect(tMatch).toBeTruthy();
    const tSec = Number(tMatch![1]);
    expect(Math.abs(tSec - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it('should throw on Discord (Ed25519 unsupported in signWith)', async () => {
    await expect(signWith(discord, { secret: 'k', payload: '{}' })).rejects.toThrow(/Ed25519/);
  });

  it('should throw on SendGrid (Ed25519 unsupported in signWith)', async () => {
    await expect(signWith(sendgrid, { secret: 'k', payload: '{}' })).rejects.toThrow(/Ed25519/);
  });

  it('should throw on Mailgun', async () => {
    await expect(signWith(mailgun, { secret: 'k', payload: '{}' })).rejects.toThrow(/Mailgun/);
  });

  it('should throw on Postmark', async () => {
    await expect(signWith(postmark, { secret: 'k', payload: '{}' })).rejects.toThrow(/Postmark/);
  });

  it('should fallback to generic provider signing when given an unrecognized provider', async () => {
    const generic = defineWebhookProvider({
      id: 'generic-test',
      algorithm: 'HMAC-SHA256',
      parseSignature: () => null,
      extractTimestamp: () => null,
      buildSigningString: ({ rawBody }) => rawBody,
      parseEvent: () => ({}),
    });
    const out = await signWith(generic, { secret: 'k', payload: '{}', timestamp: 1 });
    expect(out.headers['x-signature']).toMatch(/^[0-9a-f]+$/);
  });

  it('should fallback to HMAC-SHA1 when generic provider declares it', async () => {
    const generic = defineWebhookProvider({
      id: 'generic-sha1',
      algorithm: 'HMAC-SHA1',
      parseSignature: () => null,
      extractTimestamp: () => null,
      parseEvent: () => ({}),
    });
    const out = await signWith(generic, { secret: 'k', payload: '{}', timestamp: 1 });
    expect(out.headers['x-signature']).toMatch(/^[0-9a-f]+$/);
  });
});

describe('fixtures', () => {
  it('should expose JSON-string fixtures for the major providers', () => {
    expect(typeof fixtures.stripePaymentIntentSucceeded).toBe('string');
    expect(typeof fixtures.githubPushEvent).toBe('string');
    expect(typeof fixtures.shopifyOrderCreated).toBe('string');
    expect(typeof fixtures.slackUrlVerification).toBe('string');
    expect(typeof fixtures.svixUserCreated).toBe('string');
    expect(typeof fixtures.paddleSubscriptionUpdated).toBe('string');
    expect(typeof fixtures.lemonSqueezyOrderCreated).toBe('string');
  });

  it('should produce valid JSON parseable to objects', () => {
    expect(() => JSON.parse(fixtures.stripePaymentIntentSucceeded)).not.toThrow();
    expect(() => JSON.parse(fixtures.githubPushEvent)).not.toThrow();
  });
});
