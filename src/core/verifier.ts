import { configError, WebhookError } from '../errors/index.js';
import { readRawBody } from './body.js';
import { systemClock } from './clock.js';
import { hmacSha1, hmacSha256, secretToBytes } from './crypto.js';
import { fromFetchHeaders, fromHeadersInit } from './headers.js';
import { enforceTimestampTolerance } from './replay.js';
import { timingSafeEqual } from './timing-safe.js';
import type {
  EventOf,
  HeaderBag,
  Logger,
  Metrics,
  NormalizedRequest,
  VerificationResult,
  Verifier,
  VerifierInput,
  VerifierOptions,
  WebhookProvider,
} from './types.js';

const DEFAULT_TOLERANCE_SECONDS = 300;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

const noopMetrics: Metrics = { increment: () => undefined };
const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Create a {@link Verifier} for a single provider. Stateless and runtime-
 * agnostic; safe to instantiate at module load and reuse across requests.
 *
 * @typeParam P - Provider plugin type (e.g. `typeof stripe`). The
 *                resulting verifier's event payload is inferred from `P`.
 *
 * @param options.provider     Provider plugin.
 * @param options.secret       Single secret OR an array (zero-downtime rotation).
 *                             Throws `WebhookError(code: 'CONFIG')` if missing/empty.
 * @param options.tolerance    Replay window in seconds. Default `300`. `Infinity` disables.
 * @param options.maxBodyBytes Body size cap (DoS guard). Default `1_048_576` (1 MiB).
 * @param options.clock        Override `Date.now()` source.
 * @param options.logger       Optional structured logger.
 * @param options.metrics      Optional counter-only metrics sink.
 * @param options.onError      Override default error response shaping.
 *
 * @returns A `Verifier` with `.verify(input)` and `.providerId`.
 *
 * @throws {WebhookError} (code `CONFIG`) if `secret` or `provider` is missing/invalid.
 *
 * @example
 * ```ts
 * import { createVerifier } from '@paysuite/webhook-toolkit';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const verifier = createVerifier({
 *   provider: stripe,
 *   secret: process.env.STRIPE_WEBHOOK_SECRET!,
 * });
 *
 * const result = await verifier.verify(request);
 * if (!result.ok) return new Response(result.error.message, { status: result.error.httpStatus });
 * // result.event is fully typed as a Stripe discriminated event.
 * ```
 */
export function createVerifier<P extends WebhookProvider>(options: VerifierOptions<P>): Verifier<P> {
  if (!options.provider) throw configError('createVerifier: `provider` is required');
  const provider = options.provider;
  const secrets = normalizeSecrets(options.secret, provider.id);
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? noopLogger;
  const metrics = options.metrics ?? noopMetrics;

  const verify = async (input: VerifierInput): Promise<VerificationResult<EventOf<P>>> => {
    const receivedAt = clock.now();
    let normalized: NormalizedRequest;
    try {
      normalized = await normalizeRequest(input, maxBodyBytes);
    } catch (cause) {
      const err = toWebhookError(cause, provider.id);
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }

    let parsed: { signatures: Uint8Array[]; raw: string } | null;
    try {
      parsed = provider.parseSignature(normalized.headers);
    } catch (cause) {
      const err = new WebhookError({
        code: 'SIGNATURE_MALFORMED',
        message: 'Signature header could not be parsed',
        httpStatus: 400,
        providerId: provider.id,
        cause,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }
    if (!parsed) {
      const err = new WebhookError({
        code: 'SIGNATURE_MISSING',
        message: `Missing signature header for provider '${provider.id}'`,
        httpStatus: 400,
        providerId: provider.id,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }
    if (parsed.signatures.length === 0) {
      const err = new WebhookError({
        code: 'SIGNATURE_MALFORMED',
        message: 'Signature header contained no usable signatures',
        httpStatus: 400,
        providerId: provider.id,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }

    let timestamp: number | null;
    try {
      timestamp = provider.extractTimestamp(normalized.headers, normalized.rawBody);
    } catch (cause) {
      const err = new WebhookError({
        code: 'TIMESTAMP_INVALID',
        message: 'Timestamp could not be parsed from request',
        httpStatus: 400,
        providerId: provider.id,
        cause,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }

    const replayErr = enforceTimestampTolerance(timestamp, receivedAt, tolerance, provider.id);
    if (replayErr) {
      logger.warn('verify.replay', { providerId: provider.id });
      metrics.increment('replay.exceeded', { providerId: provider.id });
      metrics.increment('verify.fail', { providerId: provider.id, code: replayErr.code });
      return { ok: false, error: replayErr };
    }

    const matched = await tryAllSecrets({
      provider,
      secrets,
      signatures: parsed.signatures,
      rawBody: normalized.rawBody,
      timestamp,
      url: normalized.url,
      method: normalized.method,
      headers: normalized.headers,
    });

    if (!matched) {
      const err = new WebhookError({
        code: 'SIGNATURE_MISMATCH',
        message: 'Signature did not match any configured secret',
        httpStatus: 401,
        providerId: provider.id,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }

    let event: EventOf<P>;
    try {
      event = provider.parseEvent(normalized.rawBody) as EventOf<P>;
    } catch (cause) {
      const err = new WebhookError({
        code: 'PAYLOAD_PARSE',
        message: 'Verified body could not be parsed as a provider event',
        httpStatus: 400,
        providerId: provider.id,
        cause,
      });
      logger.warn('verify.fail', { providerId: provider.id, code: err.code });
      metrics.increment('verify.fail', { providerId: provider.id, code: err.code });
      return { ok: false, error: err };
    }

    const rawIdempotencyKey = provider.idempotencyKey?.(normalized, event) ?? null;
    const idempotencyKey = rawIdempotencyKey === null ? null : `${provider.id}:${rawIdempotencyKey}`;

    logger.debug('verify.ok', { providerId: provider.id });
    metrics.increment('verify.ok', { providerId: provider.id });

    return {
      ok: true,
      event,
      rawBody: normalized.rawBody,
      idempotencyKey,
      receivedAt,
    };
  };

  return {
    providerId: provider.id,
    verify,
  };
}

function normalizeSecrets(
  secret: VerifierOptions<WebhookProvider>['secret'],
  providerId: string,
): ReadonlyArray<Uint8Array> {
  if (secret === undefined || secret === null) {
    throw configError('createVerifier: `secret` is required', providerId);
  }
  const arr = Array.isArray(secret) ? secret : [secret as string | Uint8Array];
  if (arr.length === 0) throw configError('createVerifier: `secret` must not be empty', providerId);
  return arr.map((s) => secretToBytes(s));
}

async function tryAllSecrets(args: {
  provider: WebhookProvider;
  secrets: ReadonlyArray<Uint8Array>;
  signatures: Uint8Array[];
  rawBody: Uint8Array;
  timestamp: number | null;
  url: string;
  method: string;
  headers: HeaderBag;
}): Promise<boolean> {
  const { provider, secrets, signatures, rawBody, timestamp, url, method, headers } = args;

  if (provider.verify) {
    for (const secret of secrets) {
      for (const signature of signatures) {
        if (await provider.verify({ signature, secret, rawBody, timestamp, url, method, headers })) {
          return true;
        }
      }
    }
    return false;
  }

  if (!provider.buildSigningString) {
    throw configError(
      `Provider '${provider.id}' must define either 'buildSigningString' or 'verify'`,
      provider.id,
    );
  }
  const signingString = provider.buildSigningString({ rawBody, timestamp, url, method, headers });

  const algo = provider.algorithm;
  for (const secret of secrets) {
    const expected = algo === 'HMAC-SHA1'
      ? await hmacSha1(secret, signingString)
      : algo === 'HMAC-SHA256'
        ? await hmacSha256(secret, signingString)
        : null;

    if (expected === null) {
      throw configError(
        `Provider '${provider.id}' uses ${algo} but provides no 'verify' implementation`,
        provider.id,
      );
    }

    for (const signature of signatures) {
      if (timingSafeEqual(signature, expected)) return true;
    }
  }
  return false;
}

function isFetchRequest(input: VerifierInput): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function isNormalizedRequest(input: VerifierInput): input is NormalizedRequest {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as { rawBody?: unknown; headers?: unknown; url?: unknown; method?: unknown };
  return (
    candidate.rawBody instanceof Uint8Array &&
    typeof candidate.url === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.headers === 'object' &&
    candidate.headers !== null &&
    typeof (candidate.headers as HeaderBag).get === 'function' &&
    typeof (candidate.headers as HeaderBag).has === 'function'
  );
}

async function normalizeRequest(input: VerifierInput, maxBodyBytes: number): Promise<NormalizedRequest> {
  if (isFetchRequest(input)) {
    const cloned = input.clone();
    const rawBody = new Uint8Array(await cloned.arrayBuffer());
    if (rawBody.length > maxBodyBytes) {
      throw new WebhookError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Payload exceeds maxBodyBytes (${String(maxBodyBytes)})`,
        httpStatus: 413,
        meta: { length: rawBody.length, maxBytes: maxBodyBytes },
      });
    }
    return {
      headers: fromFetchHeaders(input.headers),
      rawBody,
      url: input.url,
      method: input.method,
    };
  }

  if (isNormalizedRequest(input)) {
    if (input.rawBody.length > maxBodyBytes) {
      throw new WebhookError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Payload exceeds maxBodyBytes (${String(maxBodyBytes)})`,
        httpStatus: 413,
        meta: { length: input.rawBody.length, maxBytes: maxBodyBytes },
      });
    }
    return input;
  }

  const obj = input;
  const rawBody = await readRawBody(obj.rawBody, maxBodyBytes);
  return {
    headers: fromHeadersInit(obj.headers),
    rawBody,
    url: obj.url ?? '',
    method: obj.method ?? 'POST',
  };
}

function toWebhookError(cause: unknown, providerId: string): WebhookError {
  if (cause instanceof WebhookError) return cause;
  return new WebhookError({
    code: 'PAYLOAD_PARSE',
    message: cause instanceof Error ? cause.message : 'Unknown error while reading request',
    httpStatus: 400,
    providerId,
    cause,
  });
}

/**
 * Define a custom provider plugin. Use when integrating a provider not
 * yet shipped in the library, or for in-house webhook formats. Identity
 * function — exists to give users a typed entry point and a stable name.
 *
 * @typeParam TEvent - Discriminated union of events the provider emits.
 * @param spec       - Provider strategy implementation.
 * @returns The same `spec`, narrowed to `WebhookProvider<TEvent>`.
 *
 * @example
 * ```ts
 * import { defineWebhookProvider } from '@paysuite/webhook-toolkit';
 *
 * export const myCorpProvider = defineWebhookProvider({
 *   id: 'mycorp',
 *   algorithm: 'HMAC-SHA256',
 *   parseSignature: (h) => {
 *     const raw = h.get('x-mycorp-signature');
 *     return raw ? { signatures: [hex.decode(raw)], raw } : null;
 *   },
 *   extractTimestamp: (h) => Number(h.get('x-mycorp-timestamp')) * 1000 || null,
 *   buildSigningString: ({ rawBody, timestamp }) =>
 *     concat(utf8.encode(`${timestamp ?? 0}.`), rawBody),
 *   parseEvent: (raw) => JSON.parse(utf8.decode(raw)),
 * });
 * ```
 */
export function defineWebhookProvider<TEvent = unknown>(
  spec: WebhookProvider<TEvent>,
): WebhookProvider<TEvent> {
  return spec;
}

/** @deprecated Alias of {@link defineWebhookProvider}; kept for shorter call sites. */
export const defineProvider = defineWebhookProvider;
