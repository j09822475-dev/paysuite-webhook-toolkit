import { describe, expect, it } from 'vitest';
import { extractRetryMetadata } from '../retry/index.js';
import { fromRecord } from '../core/headers.js';

describe('extractRetryMetadata', () => {
  it('should detect github delivery via X-GitHub-Delivery + X-GitHub-Hook-ID', () => {
    const meta = extractRetryMetadata(
      'github',
      fromRecord({ 'x-github-hook-id': '1', 'x-github-delivery': 'd1' }),
    );
    expect(meta.isRetry).toBe(true);
    expect(meta.attempt).toBeNull();
    expect(meta.deliveryId).toBe('d1');
  });

  it('should report github isRetry=false when only one of the headers is present', () => {
    expect(extractRetryMetadata('github', fromRecord({ 'x-github-delivery': 'd1' })).isRetry).toBe(false);
  });

  it('should compute svix attempt as svix-num-retries + 1', () => {
    const meta = extractRetryMetadata(
      'svix',
      fromRecord({ 'svix-num-retries': '2', 'webhook-id': 'w1' }),
    );
    expect(meta.isRetry).toBe(true);
    expect(meta.attempt).toBe(3);
    expect(meta.deliveryId).toBe('w1');
  });

  it('should accept webhook-attempt as fallback to svix-num-retries', () => {
    const meta = extractRetryMetadata('clerk', fromRecord({ 'webhook-attempt': '1' }));
    expect(meta.isRetry).toBe(true);
    expect(meta.attempt).toBe(2);
  });

  it('should report svix isRetry=false when num-retries is 0', () => {
    expect(extractRetryMetadata('svix', fromRecord({ 'svix-num-retries': '0' })).isRetry).toBe(false);
  });

  it('should report svix attempt=null when value is non-numeric', () => {
    const meta = extractRetryMetadata('svix', fromRecord({ 'svix-num-retries': 'abc' }));
    expect(meta.isRetry).toBe(false);
    expect(meta.attempt).toBeNull();
  });

  it('should resend uses svix-style with webhook-id as delivery id', () => {
    const meta = extractRetryMetadata('resend', fromRecord({ 'webhook-id': 'r1' }));
    expect(meta.deliveryId).toBe('r1');
  });

  it('should report shopify deliveryId from X-Shopify-Webhook-Id, isRetry false', () => {
    expect(
      extractRetryMetadata('shopify', fromRecord({ 'x-shopify-webhook-id': 'w' })).deliveryId,
    ).toBe('w');
    expect(
      extractRetryMetadata('shopify', fromRecord({ 'x-shopify-delivery-id': 'd' })).deliveryId,
    ).toBe('d');
  });

  it('should always report stripe as no-retry/no-id at the header layer', () => {
    expect(extractRetryMetadata('stripe', fromRecord({}))).toEqual({
      isRetry: false,
      attempt: null,
      deliveryId: null,
    });
  });

  it('should fall back to webhook-id then x-request-id for unknown providers', () => {
    expect(extractRetryMetadata('mystery', fromRecord({ 'webhook-id': 'w' })).deliveryId).toBe('w');
    expect(extractRetryMetadata('mystery', fromRecord({ 'x-request-id': 'r' })).deliveryId).toBe('r');
    expect(extractRetryMetadata('mystery', fromRecord({})).deliveryId).toBeNull();
  });
});
