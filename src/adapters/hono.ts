import type { WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Minimal Hono context shape (`c.req.raw` is a Web `Request`). */
export interface HonoLikeContext {
  req: { raw: Request };
}

/** Options for `honoWebhook`. */
export interface HonoWebhookOptions {
  readonly onError?: (err: WebhookError) => Response;
  readonly successResponse?: () => Response;
}

/**
 * Hono middleware factory. Wraps `c.req.raw.clone()` so downstream
 * middleware can re-read the body if needed.
 *
 * @typeParam P - Provider type carried through.
 * @param verifier - The verifier.
 * @param handler  - Webhook handler.
 * @param options  - Override knobs.
 * @returns A Hono handler `(c) => Promise<Response>`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { honoWebhook } from '@paysuite/webhook-toolkit/adapters/hono';
 * const app = new Hono();
 * app.post('/webhooks/stripe', honoWebhook(verifier, async (event) => { ... }));
 * ```
 */
export function honoWebhook<P extends WebhookProvider>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, HonoLikeContext>,
  options: HonoWebhookOptions = {},
): (c: HonoLikeContext) => Promise<Response> {
  const onError = options.onError ?? defaultErrorResponse;
  const successResponse = options.successResponse ?? (() => new Response(null, { status: 204 }));

  return async (c) => {
    const req = c.req.raw.clone();
    const response = await runHandler(verifier, handler, req, c, onError);
    return response ?? successResponse();
  };
}
