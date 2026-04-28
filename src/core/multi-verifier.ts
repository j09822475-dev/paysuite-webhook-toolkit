import { configError, WebhookError } from '../errors/index.js';
import { readRawBody } from './body.js';
import { fromFetchHeaders, fromHeadersInit } from './headers.js';
import type {
  EventOf,
  HeaderBag,
  NormalizedRequest,
  VerificationResult,
  Verifier,
  VerifierInput,
  WebhookProvider,
} from './types.js';

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** Options for `createMultiVerifier`. */
export interface MultiVerifierOptions<TVerifiers extends Record<string, Verifier<WebhookProvider<any>>>> {
  /**
   * - `'by-path'` (default) — last URL path segment must match a key in `verifiers`.
   * - `'by-header'` — `x-webhook-provider` (or `headerName`) header value must match.
   * - function — full request inspection; return the chosen key, or `null` for "no match".
   */
  readonly dispatch?:
    | 'by-path'
    | 'by-header'
    | ((req: NormalizedRequest) => keyof TVerifiers | null);
  /** Custom header name when `dispatch === 'by-header'`. Default `'x-webhook-provider'`. */
  readonly headerName?: string;
  /**
   * Hard upper bound on raw body size in bytes; enforced as bytes arrive
   * before any child verifier runs. Default `1_048_576` (1 MiB). The cap
   * lives at the dispatcher level because the body is buffered here once
   * (and shared with the chosen child) — without it, a 500 MiB body would
   * be fully resident before the child's own `maxBodyBytes` kicked in.
   */
  readonly maxBodyBytes?: number;
}

/**
 * The merged event type — discriminated union over every child verifier's events,
 * plus `providerId: keyof TVerifiers` so handlers can branch.
 */
export type MultiVerifierEvent<TVerifiers extends Record<string, Verifier<WebhookProvider<any>>>> = {
  [K in keyof TVerifiers]: K extends string
    ? {
        readonly providerId: K;
        readonly event: EventOf<NonNullable<TVerifiers[K]['__providerMarker']>>;
      }
    : never;
}[keyof TVerifiers];

/**
 * Compose several Verifiers into a single dispatching `Verifier`.
 *
 * The dispatcher inspects the request and picks **one** child verifier;
 * dispatch is by URL path segment by default (e.g. `/webhooks/stripe`
 * → `verifiers.stripe`), or by a user-supplied function. The result is
 * itself a `Verifier`, so it composes with `withIdempotency`, the
 * framework adapters, and the typed router.
 *
 * @typeParam TVerifiers - `Record<string, Verifier>`, where the keys are
 *                         the provider id strings used for dispatch.
 *
 * @param verifiers - Map of providerId → child `Verifier`.
 * @param options   - Dispatch strategy. Defaults to `'by-path'`.
 *
 * @returns A `Verifier` whose verified event union is the discriminated
 *          merge of all child events, tagged with `providerId`.
 *
 * @example
 * ```ts
 * const multi = createMultiVerifier({
 *   stripe: createVerifier({ provider: stripe, secret: env.STRIPE_SECRET }),
 *   github: createVerifier({ provider: github, secret: env.GH_SECRET }),
 * });
 * const result = await multi.verify(request);
 * if (result.ok) {
 *   if (result.event.providerId === 'stripe') {
 *     // result.event.event is StripeEvent
 *   }
 * }
 * ```
 */
export function createMultiVerifier<TVerifiers extends Record<string, Verifier<WebhookProvider<any>>>>(
  verifiers: TVerifiers,
  options: MultiVerifierOptions<TVerifiers> = {},
): Verifier<WebhookProvider<MultiVerifierEvent<TVerifiers>>> {
  if (!verifiers || Object.keys(verifiers).length === 0) {
    throw configError('createMultiVerifier: at least one verifier is required');
  }
  const dispatchMode = options.dispatch ?? 'by-path';
  const headerName = options.headerName ?? 'x-webhook-provider';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const verify = async (
    input: VerifierInput,
  ): Promise<VerificationResult<MultiVerifierEvent<TVerifiers>>> => {
    let normalized: NormalizedRequest;
    try {
      normalized = await normalize(input, maxBodyBytes);
    } catch (cause) {
      const err = cause instanceof WebhookError
        ? cause
        : new WebhookError({
            code: 'PAYLOAD_PARSE',
            message: 'Failed to read request',
            httpStatus: 400,
            cause,
          });
      return { ok: false, error: err };
    }

    let key: string | null;
    if (typeof dispatchMode === 'function') {
      const chosen = dispatchMode(normalized);
      key = chosen === null ? null : String(chosen);
    } else if (dispatchMode === 'by-header') {
      key = normalized.headers.get(headerName);
    } else {
      key = lastPathSegment(normalized.url);
    }

    if (!key || !Object.prototype.hasOwnProperty.call(verifiers, key)) {
      return {
        ok: false,
        error: new WebhookError({
          code: 'SIGNATURE_MISSING',
          message: `No verifier registered for dispatched key '${String(key ?? '')}'`,
          httpStatus: 400,
          meta: { availableKeys: Object.keys(verifiers) },
        }),
      };
    }

    const child = verifiers[key]!;
    const result = await child.verify(normalized);
    if (!result.ok) return result;
    return {
      ok: true,
      event: { providerId: key, event: result.event } as MultiVerifierEvent<TVerifiers>,
      rawBody: result.rawBody,
      idempotencyKey: result.idempotencyKey,
      receivedAt: result.receivedAt,
    };
  };

  return {
    providerId: 'multi',
    verify,
  };
}

function lastPathSegment(url: string): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url, 'http://placeholder.local').pathname;
  } catch {
    pathname = url;
  }
  const trimmed = pathname.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const seg = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return seg.length > 0 ? seg : null;
}

async function normalize(input: VerifierInput, maxBodyBytes: number): Promise<NormalizedRequest> {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const cloned = input.clone();
    const stream = cloned.body;
    const rawBody = stream
      ? await readRawBody(stream, maxBodyBytes)
      : enforceCap(new Uint8Array(await cloned.arrayBuffer()), maxBodyBytes);
    return {
      headers: fromFetchHeaders(input.headers),
      rawBody,
      url: input.url,
      method: input.method,
    };
  }
  const candidate = input as {
    headers?: unknown;
    rawBody?: unknown;
    url?: unknown;
    method?: unknown;
  };
  if (candidate.rawBody instanceof Uint8Array && typeof candidate.url === 'string') {
    enforceCap(candidate.rawBody, maxBodyBytes);
    return input as NormalizedRequest;
  }
  const flexible = input as {
    headers: HeadersInit | Record<string, string | string[] | undefined>;
    rawBody: Parameters<typeof readRawBody>[0];
    url?: string;
    method?: string;
  };
  return {
    headers: fromHeadersInit(flexible.headers) as HeaderBag,
    rawBody: await readRawBody(flexible.rawBody, maxBodyBytes),
    url: flexible.url ?? '',
    method: flexible.method ?? 'POST',
  };
}

function enforceCap(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.length > maxBytes) {
    throw new WebhookError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Payload exceeds maxBodyBytes (${String(maxBytes)})`,
      httpStatus: 413,
      meta: { length: bytes.length, maxBytes },
    });
  }
  return bytes;
}
