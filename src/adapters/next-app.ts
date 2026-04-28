import type { WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Options for `nextAppWebhook`. */
export interface NextAppWebhookOptions {
  readonly onError?: (err: WebhookError) => Response;
  readonly successResponse?: () => Response;
}

/**
 * Build a Next.js App Router route handler. Compatible with the Edge
 * runtime — only Web Crypto is used internally, no `node:*` imports.
 *
 * @typeParam P - Provider type carried through.
 * @param verifier - The verifier.
 * @param handler  - Webhook handler.
 * @param options  - Override knobs.
 *
 * @returns `async function POST(request: Request): Promise<Response>`.
 *
 * @example
 * ```ts
 * import { nextAppWebhook } from '@paysuite/webhook-toolkit/adapters/next-app';
 * export const POST = nextAppWebhook(verifier, async (event) => { ... });
 * export const runtime = 'edge';
 * ```
 */
export function nextAppWebhook<P extends WebhookProvider>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, Request>,
  options: NextAppWebhookOptions = {},
): (request: Request) => Promise<Response> {
  const onError = options.onError ?? defaultErrorResponse;
  const successResponse = options.successResponse ?? (() => new Response(null, { status: 204 }));

  return async (request) => {
    const response = await runHandler(verifier, handler, request, request, onError);
    return response ?? successResponse();
  };
}
