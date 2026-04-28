import { WebhookError } from '../errors/index.js';
import { utf8 } from './encoding.js';
import type { RawBodyInput } from './types.js';

/**
 * Buffer any of the supported body inputs into a `Uint8Array`, while
 * enforcing `maxBytes` against the streaming source as bytes arrive.
 *
 * Streaming bodies are intentionally drained via the
 * `new Uint8Array(await new Response(stream).arrayBuffer())` idiom rather
 * than the newer `Response#bytes()`: the latter is TC39 stage-3 and not
 * yet exposed by Cloudflare Workers / Vercel Edge as of this version,
 * which would silently break the lib's headline runtime targets.
 *
 * @param input    - Bytes / string / ArrayBuffer / ReadableStream.
 * @param maxBytes - Hard cap. When exceeded, throws a `PAYLOAD_TOO_LARGE`
 *                   `WebhookError`. Pass `Infinity` to disable.
 * @returns Buffered body as a `Uint8Array`.
 * @throws {WebhookError} (code `PAYLOAD_TOO_LARGE`) if the body exceeds `maxBytes`.
 *
 * @example
 * ```ts
 * const raw = await readRawBody(request.body!, 1_048_576);
 * ```
 */
export async function readRawBody(input: RawBodyInput, maxBytes: number): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    enforceMax(input.length, maxBytes);
    return input;
  }
  if (input instanceof ArrayBuffer) {
    enforceMax(input.byteLength, maxBytes);
    return new Uint8Array(input);
  }
  if (typeof input === 'string') {
    const bytes = utf8.encode(input);
    enforceMax(bytes.length, maxBytes);
    return bytes;
  }
  if (typeof (input as ReadableStream<Uint8Array>).getReader === 'function') {
    return readStream(input as ReadableStream<Uint8Array>, maxBytes);
  }
  throw new WebhookError({
    code: 'PAYLOAD_PARSE',
    message: 'Unsupported raw body input',
    httpStatus: 400,
  });
}

function enforceMax(len: number, maxBytes: number): void {
  if (len > maxBytes) {
    throw new WebhookError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Payload exceeds maxBodyBytes (${String(maxBytes)})`,
      httpStatus: 413,
      meta: { length: len, maxBytes },
    });
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      enforceMax(total, maxBytes);
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
