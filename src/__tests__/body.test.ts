import { describe, expect, it } from 'vitest';
import { readRawBody } from '../core/body.js';
import { utf8 } from '../core/encoding.js';
import { WebhookError } from '../errors/index.js';

const SMALL_BODY = utf8.encode('hello world');

describe('readRawBody', () => {
  it('should return Uint8Array unchanged when input is already Uint8Array', async () => {
    const out = await readRawBody(SMALL_BODY, 1024);
    expect(out).toBe(SMALL_BODY);
  });

  it('should convert ArrayBuffer to Uint8Array when given an ArrayBuffer', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const out = await readRawBody(buf, 1024);
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should encode strings to UTF-8 bytes when given a string', async () => {
    const out = await readRawBody('héllo', 1024);
    expect(out).toEqual(utf8.encode('héllo'));
  });

  it('should drain a ReadableStream when given a stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    const out = await readRawBody(stream, 1024);
    expect(out).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('should throw PAYLOAD_TOO_LARGE when Uint8Array exceeds maxBytes', async () => {
    await expect(readRawBody(new Uint8Array(11), 10)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      httpStatus: 413,
    });
  });

  it('should throw PAYLOAD_TOO_LARGE when ArrayBuffer exceeds maxBytes', async () => {
    await expect(readRawBody(new ArrayBuffer(11), 10)).rejects.toBeInstanceOf(WebhookError);
  });

  it('should throw PAYLOAD_TOO_LARGE when string exceeds maxBytes', async () => {
    await expect(readRawBody('a'.repeat(11), 10)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('should throw PAYLOAD_TOO_LARGE when stream exceeds maxBytes mid-flight', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8)); // total 16 > 10
        controller.close();
      },
    });
    await expect(readRawBody(stream, 10)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('should accept Infinity to disable the cap', async () => {
    const big = new Uint8Array(1_000_000);
    const out = await readRawBody(big, Infinity);
    expect(out.length).toBe(1_000_000);
  });

  it('should throw PAYLOAD_PARSE for unsupported input types', async () => {
    // Force-cast intentionally: testing the runtime fallback branch.
    await expect(
      readRawBody(123 as unknown as ArrayBuffer, 1024),
    ).rejects.toMatchObject({ code: 'PAYLOAD_PARSE' });
  });
});
