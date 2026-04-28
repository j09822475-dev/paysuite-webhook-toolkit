import { SIGNATURE_FAMILY, WebhookError } from '../../errors/index.js';
import type {
  EventOf,
  VerificationResult,
  Verifier,
  VerifierInput,
  WebhookHandler,
  WebhookProvider,
} from '../../core/types.js';

/**
 * Default error → `Response` mapping. Masks `SIGNATURE_*` /
 * `TIMESTAMP_*` / `REPLAY_*` codes to a single `'invalid_signature'`
 * wire code so an attacker probing the endpoint cannot distinguish
 * between failure modes. Full `error.code` still goes to logs / metrics.
 *
 * @param err - The verification error.
 * @returns A `Response` with the error's `httpStatus` and a JSON body.
 */
export function defaultErrorResponse(err: WebhookError): Response {
  const wireCode = SIGNATURE_FAMILY.has(err.code) ? 'invalid_signature' : err.code;
  return new Response(JSON.stringify({ error: wireCode }), {
    status: err.httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Run a verifier and dispatch the result to a typed handler. Adapters
 * call this so the same verify → handler → response pipeline runs in
 * every framework.
 *
 * Returns either:
 * - a `Response` (verification failed, or the handler returned one), or
 * - `null` (the handler returned `void`; the adapter should reply with
 *   its own framework-native success ack).
 *
 * @param verifier - The verifier to run.
 * @param handler  - User handler invoked on `ok: true`.
 * @param input    - Adapter-built `VerifierInput`.
 * @param framework- Framework-specific context object passed to the handler.
 * @param onError  - Optional override for the failure mapping.
 */
export async function runHandler<P extends WebhookProvider, TCtx>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, TCtx>,
  input: VerifierInput,
  framework: TCtx,
  onError: (err: WebhookError) => Response = defaultErrorResponse,
): Promise<Response | null> {
  let result: VerificationResult<EventOf<P>>;
  try {
    result = await verifier.verify(input);
  } catch (cause) {
    const err = cause instanceof WebhookError
      ? cause
      : new WebhookError({
          code: 'PAYLOAD_PARSE',
          message: 'Verifier threw unexpectedly',
          httpStatus: 500,
          providerId: verifier.providerId,
          cause,
        });
    return onError(err);
  }

  if (!result.ok) return onError(result.error);

  const handlerResult = await handler(result.event, {
    rawBody: result.rawBody,
    idempotencyKey: result.idempotencyKey,
    providerId: verifier.providerId,
    framework,
  });
  return handlerResult ?? null;
}
