import type { WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Options for `createFetchHandler`. */
export interface FetchHandlerOptions {
  /** Override default error → Response mapping. */
  readonly onError?: (err: WebhookError) => Response;
  /** Override default success Response (when the handler returns `void`). */
  readonly successResponse?: () => Response;
}

/**
 * Create a Web-standard fetch handler for the given verifier. Returns
 * `(req: Request) => Promise<Response>`, which is the contract used by
 * Cloudflare Workers, Vercel Edge, Bun, Deno, and Next.js App Router.
 *
 * @typeParam P - Provider type carried through from `verifier`.
 * @param verifier - A verifier (raw or wrapped with `withIdempotency`).
 * @param handler  - Handler invoked with the typed event and framework context.
 * @param options  - Override knobs for error / success responses.
 *
 * @returns A function `(request: Request) => Promise<Response>`.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from '@paysuite/webhook-toolkit/adapters/fetch';
 * export default createFetchHandler(verifier, async (event, ctx) => { ... });
 * ```
 */
export function createFetchHandler<P extends WebhookProvider>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, Request>,
  options: FetchHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const onError = options.onError ?? defaultErrorResponse;
  const successResponse = options.successResponse ?? (() => new Response(null, { status: 204 }));

  return async (request: Request): Promise<Response> => {
    const response = await runHandler(verifier, handler, request, request, onError);
    return response ?? successResponse();
  };
}
