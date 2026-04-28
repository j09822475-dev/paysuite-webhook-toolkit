import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  configError,
  SIGNATURE_FAMILY,
  WebhookError,
  type ErrorCode,
  type WebhookErrorArgs,
} from '../errors/index.js';

describe('WebhookError', () => {
  it('should construct with all required fields when given full args', () => {
    const err = new WebhookError({
      code: 'SIGNATURE_MISMATCH',
      message: 'bad sig',
      httpStatus: 401,
      providerId: 'stripe',
      meta: { foo: 'bar' },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WebhookError');
    expect(err.code).toBe('SIGNATURE_MISMATCH');
    expect(err.message).toBe('bad sig');
    expect(err.httpStatus).toBe(401);
    expect(err.providerId).toBe('stripe');
    expect(err.meta).toEqual({ foo: 'bar' });
  });

  it('should default providerId to empty string when omitted', () => {
    const err = new WebhookError({ code: 'CONFIG', message: 'x', httpStatus: 500 });
    expect(err.providerId).toBe('');
  });

  it('should default meta to empty object when omitted', () => {
    const err = new WebhookError({ code: 'CONFIG', message: 'x', httpStatus: 500 });
    expect(err.meta).toEqual({});
  });

  it('should attach cause when supplied', () => {
    const original = new Error('underlying');
    const err = new WebhookError({
      code: 'PAYLOAD_PARSE',
      message: 'failed',
      httpStatus: 400,
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  it('should not attach cause when undefined', () => {
    const err = new WebhookError({ code: 'CONFIG', message: 'x', httpStatus: 500 });
    expect(err.cause).toBeUndefined();
  });

  it('should expose ErrorCode type as discriminated union', () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<
      | 'CONFIG'
      | 'SIGNATURE_MISSING'
      | 'SIGNATURE_MALFORMED'
      | 'SIGNATURE_MISMATCH'
      | 'TIMESTAMP_MISSING'
      | 'TIMESTAMP_INVALID'
      | 'REPLAY_WINDOW_EXCEEDED'
      | 'PAYLOAD_PARSE'
      | 'PAYLOAD_TOO_LARGE'
      | 'UNSUPPORTED_ALGORITHM'
      | 'IDEMPOTENCY_DUPLICATE'
      | 'IDEMPOTENCY_STORE'
    >();
  });

  it('should accept WebhookErrorArgs structurally', () => {
    expectTypeOf<WebhookErrorArgs>().toMatchTypeOf<{
      code: ErrorCode;
      message: string;
      httpStatus: number;
    }>();
  });
});

describe('SIGNATURE_FAMILY', () => {
  it('should contain all signature/timestamp/replay codes', () => {
    expect(SIGNATURE_FAMILY.has('SIGNATURE_MISSING')).toBe(true);
    expect(SIGNATURE_FAMILY.has('SIGNATURE_MALFORMED')).toBe(true);
    expect(SIGNATURE_FAMILY.has('SIGNATURE_MISMATCH')).toBe(true);
    expect(SIGNATURE_FAMILY.has('TIMESTAMP_MISSING')).toBe(true);
    expect(SIGNATURE_FAMILY.has('TIMESTAMP_INVALID')).toBe(true);
    expect(SIGNATURE_FAMILY.has('REPLAY_WINDOW_EXCEEDED')).toBe(true);
  });

  it('should not contain non-signature codes', () => {
    expect(SIGNATURE_FAMILY.has('CONFIG')).toBe(false);
    expect(SIGNATURE_FAMILY.has('PAYLOAD_PARSE')).toBe(false);
    expect(SIGNATURE_FAMILY.has('PAYLOAD_TOO_LARGE')).toBe(false);
    expect(SIGNATURE_FAMILY.has('IDEMPOTENCY_DUPLICATE')).toBe(false);
    expect(SIGNATURE_FAMILY.has('IDEMPOTENCY_STORE')).toBe(false);
  });
});

describe('configError', () => {
  it('should produce a CONFIG-coded WebhookError when called without metadata', () => {
    const err = configError('missing secret');
    expect(err.code).toBe('CONFIG');
    expect(err.httpStatus).toBe(500);
    expect(err.providerId).toBe('');
    expect(err.message).toBe('missing secret');
    expect(err.meta).toEqual({});
  });

  it('should include providerId and meta when supplied', () => {
    const err = configError('bad', 'stripe', { reason: 'rotation' });
    expect(err.providerId).toBe('stripe');
    expect(err.meta).toEqual({ reason: 'rotation' });
  });
});
